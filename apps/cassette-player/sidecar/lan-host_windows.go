//go:build windows

package main

import "net"

// platformLANHost is how a Windows computer names itself to its phones: its address on the Wi-Fi (the Windows
// port, 2026-11-07). A Mac names itself by its Bonjour name (routableHostname, scutil); Windows has no such
// command, and without a name the hub refused to link to the account at all, so the phones could never find the
// computer and its library never reached the cloud. The heartbeat sends it again every few minutes, so a new
// address from the router reaches the phones by the next beat. Whether Windows also answers to <name>.local is
// checked on a real Windows machine; if it does, that name survives a new address and should be preferred.
func platformLANHost() (string, bool) {
	return lanAddress()
}

// lanAddress is the address this computer reaches the rest of the network from: the one the system would send
// from toward the internet. Dialling UDP sends nothing; it only asks the system which address it would use.
// A computer on no network has none.
func lanAddress() (string, bool) {
	c, err := net.Dial("udp4", "192.0.2.1:9") // a documentation address: never routed, never answered
	if err != nil {
		return "", false
	}
	defer c.Close()
	a, ok := c.LocalAddr().(*net.UDPAddr)
	if !ok || a.IP == nil || a.IP.IsLoopback() || a.IP.IsUnspecified() {
		return "", false
	}
	return a.IP.String(), true
}
