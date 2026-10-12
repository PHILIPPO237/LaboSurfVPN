//go:build tools

// Dépendance de construction : gomobile (bind) doit trouver golang.org/x/mobile/bind dans ce module
// pour produire la bibliothèque Android (labocore.aar). Jamais compilé dans l'application.
package labocore

import _ "golang.org/x/mobile/bind"
