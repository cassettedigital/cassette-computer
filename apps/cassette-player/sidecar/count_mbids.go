//go:build ignore
package main
import ("fmt"; "io/fs"; "path/filepath")
func main() {
  root := "/repo/apps/cassette-player/music"
  total, withMBID := 0, 0
  filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
    if err != nil || d.IsDir() { return nil }
    ext := filepath.Ext(p)
    if ext != ".flac" && ext != ".mp3" { return nil }
    total++
    tags, e := readTags(p)
    if e != nil { return nil }
    if tags.MBID != "" { withMBID++ }
    return nil
  })
  fmt.Printf("total=%d with_mbid=%d need_lookup=%d\n", total, withMBID, total-withMBID)
}
