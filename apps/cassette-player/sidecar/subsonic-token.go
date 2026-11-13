package main

import (
	"crypto/md5"
	"encoding/hex"
)

// subsonicToken is the Subsonic API's token sign-in: md5(password + salt), so the password itself never
// crosses the Wi-Fi (satellite.go asks the main computer's music server this way).
func subsonicToken(password, salt string) string {
	sum := md5.Sum([]byte(password + salt))
	return hex.EncodeToString(sum[:])
}
