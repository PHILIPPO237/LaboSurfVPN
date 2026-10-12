// Package labocore est le cœur réseau de LaboSurfVPN pour tous les moteurs autres que l'UDP LABOSURF
// (qui garde son implémentation Kotlin). Il est compilé en bibliothèque Android (AAR) par gomobile.
//
// Principe : l'interface TUN ouverte par VpnService est remise à Xray-core (entrée « tun », gVisor) ;
// Xray envoie le trafic vers le moteur choisi :
//
//	xray       → client VLESS d'Xray (tcp, ws, xhttp, grpc × reality, tls, none)
//	hysteria2  → client Hysteria2 d'Xray (obfuscation salamander, certificat épinglé)
//	wireguard  → client WireGuard d'Xray
//	tuic       → adaptateur TUIC v5 de ce paquet (quic-go), joint par une sortie SOCKS locale
//	ssh, shssl, sshhttp → adaptateur SSH de ce paquet (x/crypto/ssh), joint par une sortie SOCKS locale
//
// La configuration vient du Panel (POST /api/user/connect) : lien et profil émis par LABOSURF PRO.
// Rien n'est deviné : un paramètre manquant est une erreur explicite. L'application elle-même est
// exclue du VPN (addDisallowedApplication) : les connexions sortantes de ce cœur ne bouclent jamais.
package labocore

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/xtls/xray-core/core"
	"github.com/xtls/xray-core/features/stats"
	"github.com/xtls/xray-core/infra/conf/serial"

	_ "github.com/xtls/xray-core/main/distro/all" // enregistre tous les protocoles et transports d'Xray
)

// Version du cœur (affichée par l'application).
const Version = "1.0.0"

// engines : moteurs que ce cœur sait réellement transporter (annoncés au Panel par l'application).
var engines = []string{"xray", "hysteria2", "wireguard", "tuic", "ssh", "shssl", "sshhttp"}

// Engines retourne les moteurs pris en charge, séparés par des virgules.
func Engines() string { return strings.Join(engines, ",") }

var (
	mu       sync.Mutex
	instance *core.Instance
	closers  []io.Closer
)

// Start démarre le moteur décrit par configJSON (configuration émise par le Panel) sur l'interface TUN
// déjà établie par VpnService (descripteur tunFd, MTU mtu). Une session précédente est arrêtée.
func Start(configJSON string, tunFd int, mtu int) error {
	if tunFd <= 0 {
		return errors.New("interface TUN invalide")
	}
	if mtu <= 0 {
		mtu = 1500
	}
	// L'entrée « tun » d'Xray lit le descripteur dans cette variable (common/platform.TunFdKey).
	if err := os.Setenv("xray.tun.fd", strconv.Itoa(tunFd)); err != nil {
		return err
	}
	return start(configJSON, map[string]any{
		"tag": inboundTag, "protocol": "tun", "port": 0,
		"settings": map[string]any{"name": "labosurf-tun", "MTU": mtu},
	})
}

// Stop arrête la session en cours (sans effet s'il n'y en a pas).
func Stop() {
	mu.Lock()
	defer mu.Unlock()
	stopLocked()
}

// Stats retourne le trafic RÉELLEMENT passé par le tunnel : {"rx":octets reçus,"tx":octets envoyés}.
// Sans session : {"rx":0,"tx":0,"running":false}.
func Stats() string {
	mu.Lock()
	defer mu.Unlock()
	if instance == nil {
		return `{"rx":0,"tx":0,"running":false}`
	}
	m, ok := instance.GetFeature(stats.ManagerType()).(stats.Manager)
	if !ok {
		return `{"rx":0,"tx":0,"running":true}`
	}
	value := func(name string) int64 {
		if c := m.GetCounter(name); c != nil {
			return c.Value()
		}
		return 0
	}
	// uplink = du téléphone vers le serveur (envoyé) ; downlink = reçu.
	tx := value("inbound>>>" + inboundTag + ">>>traffic>>>uplink")
	rx := value("inbound>>>" + inboundTag + ">>>traffic>>>downlink")
	return fmt.Sprintf(`{"rx":%d,"tx":%d,"running":true}`, rx, tx)
}

func stopLocked() {
	if instance != nil {
		_ = instance.Close()
		instance = nil
	}
	for _, c := range closers {
		_ = c.Close()
	}
	closers = nil
}

// start construit et démarre l'instance Xray avec l'entrée donnée (TUN en production, SOCKS en test).
func start(configJSON string, inbound map[string]any) error {
	cfg, err := parseClientConfig(configJSON)
	if err != nil {
		return err
	}
	mu.Lock()
	defer mu.Unlock()
	stopLocked()

	out, err := buildOutbound(cfg)
	if err != nil {
		for _, c := range out.closers {
			_ = c.Close()
		}
		return err
	}
	raw, err := json.Marshal(xrayConfig(inbound, out))
	if err != nil {
		return err
	}
	xc, err := serial.LoadJSONConfig(bytes.NewReader(raw))
	if err != nil {
		closeAll(out.closers)
		return fmt.Errorf("configuration du moteur refusée : %w", err)
	}
	inst, err := core.New(xc)
	if err != nil {
		closeAll(out.closers)
		return fmt.Errorf("moteur : %w", err)
	}
	if err := inst.Start(); err != nil {
		_ = inst.Close()
		closeAll(out.closers)
		return fmt.Errorf("démarrage du moteur : %w", err)
	}
	instance, closers = inst, out.closers
	return nil
}

func closeAll(cs []io.Closer) {
	for _, c := range cs {
		_ = c.Close()
	}
}

const (
	inboundTag  = "tun"
	proxyTag    = "proxy"
	dnsQueryTag = "dns-query"
)

// xrayConfig assemble la configuration Xray : une entrée, la sortie du moteur, et le routage.
// Moteur sans UDP (tuic, ssh…) : le DNS des applications passe en TCP par le tunnel (sortie « dns »
// d'Xray, serveurs tcp://) et le reste de l'UDP est bloqué (les applications reviennent au TCP).
func xrayConfig(inbound map[string]any, out outbound) map[string]any {
	ob := out.config
	ob["tag"] = proxyTag
	rules := []any{}
	cfg := map[string]any{
		"log":      map[string]any{"loglevel": "warning"},
		"stats":    map[string]any{},
		"policy":   map[string]any{"system": map[string]any{"statsInboundUplink": true, "statsInboundDownlink": true}},
		"inbounds": []any{inbound},
		"outbounds": []any{ob,
			map[string]any{"tag": "dns-out", "protocol": "dns"},
			map[string]any{"tag": "block", "protocol": "blackhole"},
		},
	}
	if out.tcpOnly {
		cfg["dns"] = map[string]any{
			"tag":           dnsQueryTag,
			"servers":       []any{"tcp://1.1.1.1", "tcp://8.8.8.8"},
			"queryStrategy": "UseIPv4",
		}
		rules = append(rules,
			map[string]any{"type": "field", "inboundTag": []string{inboundTag}, "network": "udp", "port": "53", "outboundTag": "dns-out"},
			map[string]any{"type": "field", "inboundTag": []string{dnsQueryTag}, "outboundTag": proxyTag},
			map[string]any{"type": "field", "inboundTag": []string{inboundTag}, "network": "udp", "outboundTag": "block"},
		)
	}
	rules = append(rules, map[string]any{"type": "field", "inboundTag": []string{inboundTag}, "outboundTag": proxyTag})
	cfg["routing"] = map[string]any{"domainStrategy": "AsIs", "rules": rules}
	return cfg
}
