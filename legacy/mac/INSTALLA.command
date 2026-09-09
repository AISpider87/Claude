#!/bin/bash
# Doppio clic per installare il Battitore d'Asta in Applicazioni.
cd "$(dirname "$0")" || exit 1
APP="Battitore d'Asta.app"

echo ""
echo "  Installazione di Battitore d'Asta"
echo "  ---------------------------------"

if [ ! -d "$APP" ]; then
    echo "  ✗ Non trovo \"$APP\" in questa cartella."
    echo "    Assicurati di aver estratto lo zip prima di lanciare questo file."
    echo ""
    read -n 1 -s -r -p "  Premi un tasto per chiudere."
    exit 1
fi

# macOS marca come "in quarantena" tutto ciò che arriva da internet:
# la rimuoviamo, altrimenti l'app non si apre perché non è firmata.
xattr -dr com.apple.quarantine "$APP" 2>/dev/null

DESTINAZIONE="/Applications/$APP"
if [ -d "$DESTINAZIONE" ]; then
    echo "  • Sostituisco la versione già presente in Applicazioni…"
    rm -rf "$DESTINAZIONE"
fi

if cp -R "$APP" /Applications/ 2>/dev/null; then
    xattr -dr com.apple.quarantine "$DESTINAZIONE" 2>/dev/null
    echo "  ✓ Installata in Applicazioni."
    echo "  • La apro per la prova…"
    open "$DESTINAZIONE"
else
    echo "  ! Non ho i permessi per scrivere in Applicazioni."
    echo "    L'app resta qui e funziona lo stesso: doppio clic su \"$APP\"."
    open "$APP"
fi

echo ""
read -n 1 -s -r -p "  Fatto. Premi un tasto per chiudere questa finestra."
echo ""
