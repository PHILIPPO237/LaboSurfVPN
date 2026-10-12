package labocore

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"io"
	"time"

	xnet "github.com/xtls/xray-core/common/net"
	"github.com/xtls/xray-core/core"
)

// Probe prouve que le moteur transporte RÉELLEMENT du trafic jusqu'à Internet : une vraie requête DNS
// (example.com, en TCP) part par le moteur vers 1.1.1.1:53 et une réponse valide (même identifiant,
// bit de réponse) doit revenir. Sans cette preuve, l'application n'annonce jamais « connecté ».
func Probe() error {
	mu.Lock()
	inst := instance
	mu.Unlock()
	if inst == nil {
		return errors.New("aucune session")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	conn, err := core.Dial(ctx, inst, xnet.TCPDestination(xnet.ParseAddress("1.1.1.1"), xnet.Port(53)))
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(12 * time.Second))

	var id [2]byte
	_, _ = rand.Read(id[:])
	q := append([]byte{id[0], id[1], 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0}, encodeName("example.com")...)
	q = append(q, 0, 1, 0, 1) // type A, classe IN
	msg := binary.BigEndian.AppendUint16(nil, uint16(len(q)))
	if _, err := conn.Write(append(msg, q...)); err != nil {
		return err
	}
	var l [2]byte
	if _, err := io.ReadFull(conn, l[:]); err != nil {
		return err
	}
	n := binary.BigEndian.Uint16(l[:])
	if n < 12 {
		return errors.New("réponse DNS invalide")
	}
	resp := make([]byte, n)
	if _, err := io.ReadFull(conn, resp); err != nil {
		return err
	}
	if resp[0] != id[0] || resp[1] != id[1] || resp[2]&0x80 == 0 {
		return errors.New("réponse DNS inattendue")
	}
	return nil
}

func encodeName(name string) []byte {
	var b []byte
	start := 0
	for i := 0; i <= len(name); i++ {
		if i == len(name) || name[i] == '.' {
			b = append(b, byte(i-start))
			b = append(b, name[start:i]...)
			start = i + 1
		}
	}
	return append(b, 0)
}
