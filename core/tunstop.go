package labocore

import (
	"context"
	"errors"
	"reflect"
	"unsafe"

	"github.com/xtls/xray-core/core"
	"github.com/xtls/xray-core/features/inbound"
	"github.com/xtls/xray-core/proxy"
	"github.com/xtls/xray-core/proxy/tun"
)

// closeTunStack arrête la pile réseau (gVisor) de l'entrée « tun » d'Xray.
//
// Pourquoi : dans Xray-core v1.260327.0, tun.Handler n'a PAS de méthode Close ; core.Instance.Close
// laisse donc tourner la boucle qui lit l'interface TUN. Elle garde le descripteur ouvert dans le
// noyau : Android ne démonte pas le VPN après la déconnexion (constaté sur émulateur), et la boucle
// pourrait lire un descripteur réutilisé ensuite. On ferme donc la pile (Stack.Close : arrêt et attente
// de la boucle de lecture) AVANT que l'application ne ferme l'interface.
//
// Le champ est non exporté : il est lu par réflexion. TestTunHandlerKeepsItsStackField vérifie à chaque
// montée de version d'Xray que ce champ existe toujours avec ce type (sinon le test échoue).
func closeTunStack(inst *core.Instance) error {
	m, ok := inst.GetFeature(inbound.ManagerType()).(inbound.Manager)
	if !ok {
		return errors.New("gestionnaire d'entrées introuvable")
	}
	h, err := m.GetHandler(context.Background(), inboundTag)
	if err != nil {
		return err
	}
	g, ok := h.(interface{ GetInbound() proxy.Inbound })
	if !ok {
		return errors.New("entrée tun sans accès au gestionnaire")
	}
	th, ok := g.GetInbound().(*tun.Handler)
	if !ok {
		return nil // entrée de test (socks) : rien à fermer
	}
	s := tunStackOf(th)
	if s == nil {
		return nil
	}
	return s.Close()
}

// tunStackOf lit le champ non exporté tun.Handler.stack (nil s'il est absent ou vide).
func tunStackOf(th *tun.Handler) tun.Stack {
	f := reflect.ValueOf(th).Elem().FieldByName("stack")
	if !f.IsValid() || f.Type() != reflect.TypeOf((*tun.Stack)(nil)).Elem() {
		return nil
	}
	v := reflect.NewAt(f.Type(), unsafePointer(f)).Elem().Interface()
	s, _ := v.(tun.Stack)
	return s
}

func unsafePointer(f reflect.Value) unsafe.Pointer { return unsafe.Pointer(f.UnsafeAddr()) }
