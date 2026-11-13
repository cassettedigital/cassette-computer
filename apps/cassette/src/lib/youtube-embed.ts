/**
 * YouTube's player, driven by messages to its own frame (BUG-870). YouTube's IFrame API script ran Google's code
 * inside our page, and in the desktop app that page is the one that can call the app's commands (pairing, sign
 * out, updates). Here everything of YouTube's stays inside YouTube's frame, on YouTube's origin, and we talk to it
 * the way that script does: JSON over postMessage. No script of theirs ever loads into ours.
 *
 * The compliance rules are unchanged (YouTubeFullSongPlayer.tsx's note): the video is visible, YouTube serves its
 * own ads, we never touch the audio stream, and playback starts from the person's click.
 *
 * The shape copies the slice of YT.Player the two players use, events included ({ target, data }), so swapping it
 * in is the constructor and nothing else.
 */

const YT_ORIGIN = "https://www.youtube.com";

export type EmbedEvent = { target: YouTubeEmbed; data: number };

export type EmbedOptions = {
  videoId: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (e: { target: YouTubeEmbed }) => void;
    /** -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued */
    onStateChange?: (e: EmbedEvent) => void;
    /** 2 invalid id, 5 HTML5 error, 100 not found/private, 101/150 embedding disabled, 153 referer rejected */
    onError?: (e: EmbedEvent) => void;
  };
};

let nextId = 1;

export class YouTubeEmbed {
  private readonly frame: HTMLIFrameElement;
  private readonly id = nextId++;
  private readonly events: NonNullable<EmbedOptions["events"]>;
  private ready = false;
  private gone = false;
  private waiting: Array<{ func: string; args: unknown[] }> = [];
  private hello: ReturnType<typeof setInterval> | null = null;
  // What the frame last told us, and when, so the time keeps moving between its reports.
  private state = -1;
  private time = 0;
  private timeAt = 0;
  private duration = 0;
  private volume = 100;

  constructor(host: HTMLElement, opts: EmbedOptions) {
    this.events = opts.events ?? {};
    const params = new URLSearchParams({ enablejsapi: "1", origin: window.location.origin, widgetid: String(this.id) });
    for (const [k, v] of Object.entries(opts.playerVars ?? {})) params.set(k, String(v));
    const frame = document.createElement("iframe");
    frame.src = `${YT_ORIGIN}/embed/${encodeURIComponent(opts.videoId)}?${params}`;
    frame.title = "YouTube video player";
    frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.border = "0";
    host.appendChild(frame);
    this.frame = frame;
    window.addEventListener("message", this.onMessage);
    // The frame answers only once it has loaded and heard that someone is listening; say so until it does.
    const listening = () => this.post({ event: "listening" });
    frame.addEventListener("load", listening);
    this.hello = setInterval(listening, 250);
  }

  loadVideoById(videoId: string, startSeconds?: number): void {
    this.time = startSeconds ?? 0;
    this.timeAt = 0;
    this.duration = 0;
    this.command("loadVideoById", [{ videoId, ...(startSeconds ? { startSeconds } : {}) }]);
  }

  playVideo(): void {
    this.command("playVideo");
  }

  pauseVideo(): void {
    this.command("pauseVideo");
  }

  setVolume(v: number): void {
    this.volume = v;
    this.command("setVolume", [v]);
  }

  getVolume(): number {
    return this.volume;
  }

  getCurrentTime(): number {
    if (this.state !== 1 || !this.timeAt) return this.time;
    const t = this.time + (Date.now() - this.timeAt) / 1000;
    return this.duration > 0 ? Math.min(t, this.duration) : t;
  }

  getDuration(): number {
    return this.duration;
  }

  destroy(): void {
    this.gone = true;
    this.stopHello();
    window.removeEventListener("message", this.onMessage);
    this.frame.remove();
  }

  private post(msg: Record<string, unknown>): void {
    if (this.gone) return;
    this.frame.contentWindow?.postMessage(JSON.stringify({ ...msg, id: this.id, channel: "widget" }), YT_ORIGIN);
  }

  /** A command before the player is ready waits for it, in order, as the API script's own queue does. */
  private command(func: string, args: unknown[] = []): void {
    if (!this.ready) this.waiting.push({ func, args });
    else this.post({ event: "command", func, args });
  }

  private stopHello(): void {
    if (this.hello) clearInterval(this.hello);
    this.hello = null;
  }

  private setState(next: number): void {
    if (next === this.state) return;
    this.state = next;
    this.events.onStateChange?.({ target: this, data: next });
  }

  private onMessage = (e: MessageEvent): void => {
    // Only our own frame, from YouTube's origin, is heard; anything else on the page is ignored.
    if (e.origin !== YT_ORIGIN || e.source !== this.frame.contentWindow || typeof e.data !== "string") return;
    let msg: { event?: string; info?: unknown };
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    this.stopHello();
    switch (msg.event) {
      case "onReady": {
        if (this.ready) return;
        this.ready = true;
        // The frame reports state changes and errors only to a listener that asks for them.
        this.post({ event: "command", func: "addEventListener", args: ["onStateChange"] });
        this.post({ event: "command", func: "addEventListener", args: ["onError"] });
        for (const c of this.waiting.splice(0)) this.post({ event: "command", ...c });
        this.events.onReady?.({ target: this });
        return;
      }
      case "initialDelivery":
      case "infoDelivery": {
        const info = (msg.info ?? {}) as { currentTime?: unknown; duration?: unknown; playerState?: unknown; volume?: unknown };
        if (typeof info.currentTime === "number") {
          this.time = info.currentTime;
          this.timeAt = Date.now();
        }
        if (typeof info.duration === "number" && info.duration > 0) this.duration = info.duration;
        if (typeof info.volume === "number") this.volume = info.volume;
        if (typeof info.playerState === "number") this.setState(info.playerState);
        return;
      }
      case "onStateChange":
        if (typeof msg.info === "number") this.setState(msg.info);
        return;
      case "onError":
        if (typeof msg.info === "number") this.events.onError?.({ target: this, data: msg.info });
        return;
    }
  };
}
