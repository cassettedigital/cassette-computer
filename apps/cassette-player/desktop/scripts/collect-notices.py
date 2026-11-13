#!/usr/bin/env python3
"""Write the Mac app's Resources/Licenses folder (BUG-780).

Everything Cassette.app ships that someone else wrote, with its licence, in one
place a person (or a lawyer) can open: Contents/Resources/Licenses.

  README.txt                 what is here and where each GPL/LGPL source lives
  THIRD-PARTY-NOTICES.txt    every component, its version, licence and licence text
  tools/<name-version>/      the rip and transcode tools' own licence files
  source/                    those tools' exact upstream source tarballs
  navidrome/                 Navidrome's licence and the fork commit it was built from
  cassette/                  Cassette's own licence and the public release its source is at

Sources of the list, each read from what is actually being shipped:
  the tools build (build-tools-macos.sh output), the Navidrome fork checkout,
  the bundled Node tarball, the UI server's node_modules, the hub's and
  Navidrome's Go modules, and the shell's Rust crates.

Stdlib only; reads the Go and Cargo caches offline.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile

LICENSE_RE = re.compile(r"^(licen[cs]e|copying|notice|copyright|unlicense)([._-].*)?$", re.I)


def licence_files(d):
    try:
        names = sorted(os.listdir(d))
    except OSError:
        return []
    return [os.path.join(d, n) for n in names if LICENSE_RE.match(n) and os.path.isfile(os.path.join(d, n))]


def read(path):
    with open(path, "rb") as f:
        return f.read().decode("utf-8", "replace").strip()


class Notices:
    def __init__(self):
        self.entries = {}  # (group, name, version) -> (licence, [texts])

    def add(self, group, name, version, licence, d):
        key = (group, name, version or "")
        if key in self.entries:
            return
        texts = [(os.path.basename(p), read(p)) for p in licence_files(d)] if d else []
        self.entries[key] = (licence or "", texts)

    def write(self, path):
        groups = {}
        for (group, name, version), v in sorted(self.entries.items()):
            groups.setdefault(group, []).append((name, version, v))
        with open(path, "w", encoding="utf-8") as out:
            out.write("Cassette for Mac: third-party software notices\n\n")
            out.write("Cassette includes the open-source software listed below. Each is used under\n")
            out.write("its own licence, reproduced in full after its name. See README.txt for where\n")
            out.write("to get the source of the GPL and LGPL components.\n")
            for group, items in groups.items():
                out.write("\n\n" + "=" * 78 + "\n" + group + "\n" + "=" * 78 + "\n")
                for name, version, (licence, texts) in items:
                    out.write("\n" + "-" * 78 + "\n")
                    out.write(f"{name} {version}".rstrip() + (f"  ({licence})" if licence else "") + "\n")
                    if not texts:
                        out.write("\n(No licence file in the package; licence as declared above.)\n")
                    for fname, text in texts:
                        out.write(f"\n[{fname}]\n{text}\n")
        return sum(len(i) for i in groups.values())


def npm_packages(notices, server_dir):
    seen = set()
    root = os.path.join(server_dir, "node_modules")
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        if "package.json" not in filenames:
            continue
        real = os.path.realpath(dirpath)
        if real in seen:
            continue
        seen.add(real)
        try:
            pkg = json.load(open(os.path.join(dirpath, "package.json"), encoding="utf-8"))
        except (OSError, ValueError):
            continue
        name, version = pkg.get("name"), pkg.get("version")
        if not name or not version or name.startswith("@discovery/"):
            continue
        lic = pkg.get("license")
        if isinstance(lic, dict):
            lic = lic.get("type")
        if not lic and isinstance(pkg.get("licenses"), list):
            lic = " OR ".join(x.get("type", "") for x in pkg["licenses"] if isinstance(x, dict))
        notices.add("UI server (Node packages)", name, version, lic, dirpath)


def go_modules(notices, group, module_dir, tags):
    env = dict(os.environ, GOFLAGS="-mod=mod", GOPROXY="off")
    fmt = "{{with .Module}}{{if not .Main}}{{.Path}}\t{{.Version}}\t{{with .Replace}}{{.Dir}}{{else}}{{.Dir}}{{end}}{{end}}{{end}}"
    cmd = ["go", "list", "-deps", "-f", fmt]
    if tags:
        cmd += ["-tags", tags]
    out = subprocess.run(cmd + ["."], cwd=module_dir, env=env, check=True, capture_output=True, text=True).stdout
    for line in sorted(set(out.splitlines())):
        parts = line.split("\t")
        if len(parts) == 3 and parts[2]:
            notices.add(group, parts[0], parts[1], None, parts[2])


def rust_crates(notices, manifest):
    out = subprocess.run(
        ["cargo", "metadata", "--format-version", "1", "--offline",
         "--filter-platform", "aarch64-apple-darwin", "--manifest-path", manifest],
        check=True, capture_output=True, text=True).stdout
    meta = json.loads(out)
    pkgs = {p["id"]: p for p in meta["packages"]}
    nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
    root = meta["resolve"]["root"]
    shipped, todo = set(), [root]
    while todo:  # only what is linked into the app: normal dependencies, not build or dev
        nid = todo.pop()
        if nid in shipped:
            continue
        shipped.add(nid)
        for dep in nodes[nid]["deps"]:
            if any(k.get("kind") is None for k in dep["dep_kinds"]):
                todo.append(dep["pkg"])
    shipped.discard(root)
    for nid in shipped:
        p = pkgs[nid]
        notices.add("App shell (Rust crates)", p["name"], p["version"], p.get("license"),
                    os.path.dirname(p["manifest_path"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--tools", required=True, help="build-tools-macos.sh output folder")
    ap.add_argument("--tool-sources", required=True)
    ap.add_argument("--navidrome", required=True, help="the fork checkout")
    ap.add_argument("--navidrome-url", required=True)
    ap.add_argument("--node-tarball", required=True)
    ap.add_argument("--node-version", required=True)
    ap.add_argument("--server", required=True, help="the standalone UI server folder")
    ap.add_argument("--sidecar", required=True)
    ap.add_argument("--cargo", required=True, help="src-tauri/Cargo.toml")
    ap.add_argument("--cassette-url", required=True, help="the public repository of the computer app")
    ap.add_argument("--cassette-version", required=True, help="this release, tagged v<version> there")
    ap.add_argument("--cassette-licence", required=True, help="the computer app's LICENSE (GPL-3.0)")
    a = ap.parse_args()

    if os.path.exists(a.out):
        shutil.rmtree(a.out)
    os.makedirs(os.path.join(a.out, "tools"))
    os.makedirs(os.path.join(a.out, "source"))
    os.makedirs(os.path.join(a.out, "navidrome"))
    os.makedirs(os.path.join(a.out, "cassette"))
    notices = Notices()

    # Cassette itself: GPL-3.0, its source the public export tagged with this release's version
    # (apps/cassette-player/export makes that copy; the tag names the release it was made for).
    shutil.copy2(a.cassette_licence, os.path.join(a.out, "cassette", "LICENSE"))
    tag = f"v{a.cassette_version}"
    with open(os.path.join(a.out, "cassette", "SOURCE.txt"), "w") as out:
        out.write("Cassette for your computer (the hub, the window, the audio helper and the player screens)\n")
        out.write("is free software under the GNU General Public License, version 3 (LICENSE here).\n\n")
        out.write(f"Its complete source for this release is the public repository:\n  {a.cassette_url}\n")
        out.write(f"at the tag {tag}:\n  {a.cassette_url}/tree/{tag}\n\n")
        out.write("The Cassette name and icons are not part of that licence (TRADEMARKS.md there).\n")

    # Rip and transcode tools: licence files, the exact source, and a notice entry each.
    versions = read(os.path.join(a.tools, "VERSIONS.txt"))
    for d in sorted(os.listdir(os.path.join(a.tools, "licenses"))):
        src = os.path.join(a.tools, "licenses", d)
        shutil.copytree(src, os.path.join(a.out, "tools", d))
        name, _, ver = d.rpartition("-")  # "libcdio-paranoia-10.2+2.0.2"
        notices.add("Rip and transcode tools", name, ver, None, src)
    tarballs = []
    for line in versions.splitlines()[1:]:
        url = line.split()[2]
        f = os.path.join(a.tool_sources, os.path.basename(url.replace("%2B", "+")))
        if not os.path.isfile(f):
            sys.exit(f"missing source tarball {f}")
        shutil.copy2(f, os.path.join(a.out, "source"))
        tarballs.append(os.path.basename(f))

    # Navidrome: GPL-3, built from the public fork at an exact commit.
    nd = subprocess.run(["git", "-C", a.navidrome, "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    for f in licence_files(a.navidrome):
        shutil.copy2(f, os.path.join(a.out, "navidrome"))
    with open(os.path.join(a.out, "navidrome", "SOURCE.txt"), "w") as out:
        out.write("Cassette's music server is Navidrome (GPL-3.0), modified by Cassette.\n\n")
        out.write(f"Its complete source, including every change, is the public fork:\n  {a.navidrome_url}\n")
        out.write(f"at commit {nd}.\n\nThe changes are listed in that repository's history on the cassette branch.\n")
    notices.add("Music server", "Navidrome (Cassette fork)", nd[:12], "GPL-3.0", a.navidrome)
    go_modules(notices, "Music server (Go modules)", a.navidrome, "netgo,sqlite_fts5")

    # Node, from the very tarball whose binary ships.
    with tarfile.open(a.node_tarball) as t:
        member = t.getmember(f"node-{a.node_version}-darwin-arm64/LICENSE")
        node_dir = os.path.join(a.out, "node")
        os.makedirs(node_dir)
        with open(os.path.join(node_dir, "LICENSE"), "wb") as out:
            out.write(t.extractfile(member).read())
    notices.add("UI runtime", "Node.js", a.node_version, "MIT, with third-party notices", node_dir)

    npm_packages(notices, a.server)
    go_modules(notices, "Library hub (Go modules)", a.sidecar, None)
    rust_crates(notices, a.cargo)
    count = notices.write(os.path.join(a.out, "THIRD-PARTY-NOTICES.txt"))

    with open(os.path.join(a.out, "README.txt"), "w") as out:
        out.write("Open-source software in Cassette\n\n")
        out.write("THIRD-PARTY-NOTICES.txt lists every component Cassette includes, with its licence.\n\n")
        out.write("Source for the GPL and LGPL components:\n\n")
        out.write("- The rip and transcode tools (ffmpeg, flac, fpcalc, cd-paranoia, cd-info and the\n")
        out.write("  libraries built into them) were built unmodified from the upstream source in\n")
        out.write("  source/: " + ", ".join(tarballs) + ".\n")
        out.write("  Their licences are in tools/. ffmpeg is an LGPL build.\n")
        out.write("- Cassette's own programs are GPL-3.0; cassette/SOURCE.txt names the public\n")
        out.write("  repository and the tag of this release.\n")
        out.write("- The music server is a modified Navidrome; navidrome/SOURCE.txt names the public\n")
        out.write("  repository and the exact commit.\n")
        out.write("- LGPL libraries among the UI server's Node packages (such as libvips, inside\n")
        out.write("  @img/sharp-libvips-*) are the publishers' unmodified builds; their source is at\n")
        out.write("  the project each package's licence names.\n\n")
        out.write("For a copy of any of this source on a disc or by email, write to\n")
        out.write("hello@cassette.digital. This offer is valid for three years from each release.\n")
    print(f"    {count} components, {len(tarballs)} source tarballs -> {a.out}")


if __name__ == "__main__":
    main()
