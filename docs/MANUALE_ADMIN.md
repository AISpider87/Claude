# SuperLega — Manuale dell'admin

Guida operativa per chi amministra la SuperLega 2026/27 nell'app. Le regole di
gioco sono in `docs/REGOLE-LEGA.md`; qui c'è **come si fanno le cose** nel
pannello admin e cosa l'app permette o impedisce.

Il pannello si apre dalla voce **Admin** della barra di navigazione (visibile
solo agli admin) e ha sette sezioni:

| Sezione                  | A cosa serve                                                               |
| ------------------------ | -------------------------------------------------------------------------- |
| **Listone e quotazioni** | import del file Excel di Fantacalcio.it, sync automatico, log degli import |
| **Squadre e rose**       | import delle rose, squadre, manager, crediti, correzioni alle rose         |
| **Sessioni di mercato**  | creare, aprire e chiudere le sessioni; report di chiusura                  |
| **Registro operazioni**  | tutte le operazioni della lega; annullamenti                               |
| **Utenti**               | iscritti, ruoli admin/manager, disattivazione                              |
| **Impostazioni lega**    | codice lega, regole numeriche, email, export Excel                         |
| **Audit log**            | chi ha fatto cosa e quando                                                 |

Convenzioni: gli orari nell'app sono sempre in **ora italiana**; crediti e
prezzi sono numeri interi; nulla viene mai cancellato (rose, listone e
operazioni conservano lo storico).

---

## 1. Primo accesso e ruolo admin

1. Registrati come tutti gli altri (**Registrati** → nome, email, password,
   **Codice lega**) e conferma l'email.
2. Il primo admin è l'indirizzo email configurato al deploy come
   "bootstrap admin": chi si registra con quell'email riceve il ruolo admin in
   automatico. Tutti gli altri nascono **manager**.
3. Verifica in **Profilo**: sotto il nome deve comparire "Ruolo: Admin" e
   nella barra deve esserci la voce **Admin**.
4. Per nominare gli altri admin (previsti due in tutto): **Admin → Utenti →
   Rendi admin** sulla riga dell'utente (vedi §6).

Un admin può anche essere manager di una squadra: basta collegarlo come gli
altri (§5.3). Le pagine Rosa e Mercato funzionano nello stesso modo.

## 2. Codice lega

Dove: **Admin → Impostazioni lega → Accesso alla lega → Codice lega →
Aggiorna codice**.

- Serve solo per **registrarsi**: chi è già iscritto non ne ha più bisogno.
- Da 4 a 64 caratteri, solo lettere, numeri e trattini; viene salvato in
  maiuscolo (i manager possono scriverlo anche in minuscolo).
- I manager non possono mai leggerlo: si comunica a voce o in chat privata.
- Il vecchio codice smette di funzionare subito.

Quando cambiarlo:

1. All'inizio della stagione, prima di comunicarlo ai 20 manager.
2. Se sospetti che sia finito a persone esterne alla lega.
3. Facoltativo: dopo che tutti i 20 si sono registrati, cambiarlo "chiude"
   le iscrizioni senza toccare nessun account.

## 3. Listone e quotazioni

Pagina **Admin → Listone e quotazioni**. In alto: **Calciatori attivi**,
**Fuori lista**, **Ultimo import** (data dell'ultimo import applicato).

### 3.1 Import manuale del file Fantacalcio.it

Il file è `Quotazioni_Fantacalcio_Stagione_2026_27.xlsx` (fogli Tutti,
Portieri, Difensori, Centrocampisti, Attaccanti, **Ceduti**). Massimo 5 MB,
solo `.xlsx`.

1. Nel riquadro **Nuovo import** scegli il file in **File Excel (.xlsx)** e
   tocca **Carica e mostra anteprima**.
2. Si apre la pagina **Anteprima import**. Leggi i contatori:
   **Nel file · Nuovi · Aggiornati · Invariati · Rientrati · Fuori lista** e la
   composizione per ruolo (P/D/C/A). Un badge "N anomalie" segnala righe
   ignorate o colonne sconosciute (non bloccano).
3. Controlla gli avvisi possibili:
   - "Primo import: tutti i N calciatori verranno creati." (solo la prima volta)
   - "Attenzione: N calciatori uscirebbero dal listone. Controlla di aver
     caricato il file completo." (più del 10 % del listone sparirebbe: quasi
     sempre è il file sbagliato o incompleto → **Annulla import**)
   - "Il file non è stato archiviato (…); l'import funziona comunque."
4. Scorri le tabelle: **Variazioni di quotazione rilevanti** (differenze di
   Qt.A oltre la soglia impostata, default 5), **Nuovi calciatori**,
   **Rientrano nel listone**, **Escono dal listone (fuori lista)**,
   **Anomalie rilevate**.
5. Tocca **Conferma e aggiorna il listone**. La pagina diventa **Import
   applicato** con "Listone aggiornato il …" e i contatori definitivi.
   Oppure **Annulla import**: l'anteprima viene scartata (stato "Annullato").

Cosa fa la conferma, in una sola transazione:

- aggiorna o crea ogni calciatore per **Id Fantacalcio** (mai per nome);
- salva una rilevazione storica di Qt.A per il grafico nella scheda giocatore;
- mette **fuori lista** chi è nel foglio Ceduti **o è assente dal file**;
  chi torna nel file viene riattivato ("Rientrati"). Nessuno viene cancellato.

Errori possibili alla conferma:

- "Il listone è cambiato dopo l'anteprima: annulla e carica di nuovo il file."
  (nel frattempo è passato un altro import, anche automatico)
- "Il file contiene troppi pochi calciatori rispetto al listone attuale: import
  bloccato per sicurezza." (meno del 50 % dei calciatori attivi: guardia
  anti-svuotamento, non aggirabile)
- "Questo import è già stato applicato." / "Questo import è stato annullato:
  carica di nuovo il file."
- "Troppi import in poco tempo: riprova tra qualche minuto." (limite 10 ogni
  10 minuti)

### 3.2 Il log degli import

Riquadro **Ultimi import**: una riga per import con **Data** (link alla pagina
di dettaglio), **File** (o "sync automatico"), **Stato** (Applicato / In
anteprima / Annullato), **Righe**, **Nuovi**, **Fuori**. Un import "In
anteprima" è un'anteprima mai confermata: aprila e conferma o annulla.

Se l'ultimo import applicato ha messo fuori lista qualcuno, sopra i riquadri
compare il banner rosso "L'ultimo import ha messo fuori lista N calciatori:
vedi chi. I manager interessati possono fare il cambio gratuito."

### 3.3 Foglio Ceduti e fuori lista

- Un calciatore **fuori lista** resta nelle rose che lo hanno, con l'etichetta
  rossa "fuori lista", finché il manager non lo sostituisce con un **cambio
  gratuito** (Mercato → Cambio gratuito, possibile anche a sessione chiusa,
  non conta nei 20, rimborso = prezzo pagato).
- Nel Listone i manager lo vedono solo attivando "Mostra fuori lista".
- Non è acquistabile e non compare tra gli svincolati.
- Alla chiusura di una sessione le rose con fuori lista risultano "da
  sistemare" nel report (§7.5).
- Non serve fare nulla a mano: basta importare il listone aggiornato.

### 3.4 Sync automatico ed "Esegui ora"

Riquadro **Sync automatico**: mostra **Stato** (attivo / disattivato),
**Sorgente** (configurata / "non configurata (solo upload manuale)") e l'esito
dell'ultimo tentativo automatico.

- Ogni giorno alle 04:30 UTC (06:30 in ora legale, 05:30 in ora solare) un job
  chiama l'app: fa sempre un "keep-alive" del database (evita la pausa del
  piano gratuito) e, **solo se** il sync è attivo **e** una sorgente è
  configurata, scarica il file, lo analizza con lo stesso parser dell'upload
  manuale e lo applica con le stesse guardie (§3.1). L'import compare nel log
  con file "sync automatico".
- **Attiva sync / Disattiva sync**: interruttore, equivale alla casella
  "Aggiornamento automatico delle quotazioni" in Impostazioni.
- **Esegui ora**: lancia subito lo stesso job con la tua sessione. È
  disabilitato se la sorgente non è configurata. Esiti: "Sync eseguito: N
  righe, N nuovi, N fuori lista.", "Il sync automatico è disattivato.",
  "Nessuna sorgente configurata (QUOTATIONS_SOURCE_URL): usa l'upload
  manuale.", "Sync non riuscito: …".

La sorgente si configura solo con la variabile d'ambiente
`QUOTATIONS_SOURCE_URL` su Vercel (vedi `docs/SYNC.md`), e solo dopo aver
verificato che il download automatico da Fantacalcio.it sia consentito. Non
inserire mai URL con credenziali o cookie in questo manuale o in chat.

**Se il sync fallisce** (riga "sync automatico" con stato Annullato: aprila
per leggere l'errore):

1. Scarica a mano il file quotazioni da Fantacalcio.it.
2. Fai l'import manuale (§3.1). Il risultato è identico.
3. Se fallisce per più giorni, disattiva il sync per non riempire il log e
   resta sul manuale; il keep-alive del database continua comunque.

### 3.5 Indisponibili (infortunati, squalificati, in dubbio)

Dove: **Admin → Indisponibili**. Serve a mostrare nella rosa di ogni manager
lo stato dei suoi calciatori, con la fonte della notizia.

1. **Segna un calciatore**: scegli il nome dal listone, lo **Stato**
   (Infortunato, In dubbio, Squalificato, Indisponibile), una **Nota**
   facoltativa (es. "rientro a ottobre"), la **Fonte** (es. Fantacalcio.it) e
   il **Link alla fonte** (deve iniziare con `https://`). **Salva stato**.
2. Nella tabella **Stati attivi** vedi tutti i segnati; **Disponibile** toglie
   lo stato. Gli stati **non scadono da soli**: aggiornali quando il
   calciatore rientra.
3. I manager vedono lo stato accanto al calciatore nella propria rosa e nel
   mercato, con "fonte: … ↗" e la data dell'aggiornamento. Ogni modifica è
   nell'audit log (`player.status`).

#### Feed automatico (API-Football)

In cima alla pagina c'è il riquadro **Feed automatico (API-Football)**. Ogni 15
minuti il feed legge indisponibili e formazioni ufficiali della Serie A e
aggiorna le rose da solo. Il riquadro mostra:

- **Ultimo aggiornamento** ed **Esito** (riuscito / riuscito con avvisi / non
  riuscito);
- **Richieste API** usate nell'ultima esecuzione (al massimo 3 su 100 al
  giorno) e la quota residua dichiarata dal fornitore;
- quanti **stati dal feed**, quanti **stati manuali tenuti**, quanti **rientri**
  (stato tolto perché l'API non lo segnala più), quanti giocatori **in
  formazione**;
- gli **errori dell'ultimo tentativo**, riportati alla lettera come li manda
  l'API (chiave sbagliata, limiti di piano, stagione non coperta…).

**Aggiorna adesso** lancia subito la stessa procedura e mostra il risultato. È
disattivato se sul server non c'è la chiave `API_FOOTBALL_KEY` (in quel caso il
feed è spento e restano solo gli stati manuali: tutto funziona come prima).

> La pianificazione ogni 15 minuti **non si attiva da sola**: va eseguita una
> volta in Supabase → SQL Editor il file
> `supabase/deploy/updates/2026-09-11-availability-cron.sql` (vedi docs/DEPLOY.md).

#### Il manuale batte il feed

Quello che scrivi tu con **Segna un calciatore** non viene **mai** sovrascritto
né cancellato dal feed: nella tabella **Stati attivi** la colonna **Origine**
dice se una riga è `manuale` o `feed`. Se il feed sbaglia su un calciatore,
segnalo tu a mano: da quel momento la tua riga vince. Per tornare al comando
automatico su quel calciatore, premi **Disponibile**: la riga manuale sparisce e
il feed potrà riscriverla al prossimo giro (se l'API lo segnala ancora).

#### Nomi da abbinare

L'API usa nomi diversi dal listone ("Lautaro Martinez" contro "Martinez Lau.").
Quando l'abbinamento è **ambiguo o impossibile**, lo stato **non viene
applicato** e il nome compare nel riquadro **Nomi da abbinare**: scegli dal menu
il calciatore giusto e premi **Abbina**. L'abbinamento resta valido per tutti
gli aggiornamenti successivi e il feed non lo cambia più. Se un nome non ha un
id dell'API non è abbinabile e lo si segna a mano.

#### Titolare / In panchina

Quando escono le formazioni ufficiali (circa un'ora prima del calcio d'inizio) i
manager vedono nella propria rosa e nel mercato il chip **Titolare** o **In
panchina**, con la fonte "API-Football" e l'ora della partita. Il chip compare
solo nelle 12 ore prima del calcio d'inizio e sparisce da solo.

Dettagli tecnici (endpoint, budget delle richieste, mappatura degli stati, cosa
succede senza chiave): `docs/SYNC.md`, sezione "Indisponibili e titolarità".

## 4. Import delle rose (export "Rose" di Leghe Fantacalcio)

Dove: **Admin → Squadre e rose → Importa le rose**.

Prerequisiti:

- Il listone deve essere già importato ("Il listone è vuoto: importa prima le
  quotazioni").
- **Nessuna sessione aperta**: a sessione aperta l'import viene rifiutato dal
  database (bypasserebbe la foto svincolati e il registro).
- File `.xlsx` (max 5 MB) con il foglio `ROSE`: squadre a blocchi di 3
  colonne (nome squadra | costo | vuota), 23 giocatori + riga `totale`;
  `*` accanto al nome = fuori lista.

### 4.1 Procedura

1. In **File Excel** scegli l'export in **Export rose (.xlsx)** e tocca
   **Carica e mostra anteprima**.
2. Pagina **Anteprima rose**. Contatori: **Squadre nel file**, **Nuove
   squadre**, **Giocatori**, **Da risolvere** (rosso se > 0).
3. Riquadro **Anomalie nel file** (se presente): `total_mismatch` (la riga
   totale non corrisponde alla somma), `invalid_cost`, `duplicate_player`,
   `duplicate_team`, `missing_total_row`, `roster_size`. Solo `roster_size`
   (rosa diversa da 23) è un avviso; le altre **bloccano** la conferma: correggi
   il file e ricaricalo.
4. Per ogni squadra c'è una scheda con: nome + badge **esistente** o
   **nuova**, "speso X · crediti residui Y", conteggio per ruolo e badge
   **3/7/7/6 ok** oppure **composizione** (rosso). La tabella ha tre colonne:
   **Nel file** (nome scritto nell'export, con badge `*` se fuori lista),
   **Costo**, **Nel listone** (a chi è stato abbinato).
5. Risolvi le righe evidenziate:
   - **omonimi** (più calciatori con lo stesso nome): menu "— scegli tra N
     omonimi —" con ruolo, squadra e Qt.A di ciascuno;
   - **non trovato**: due possibilità. Se è un errore di nome, scrivi l'**Id
     Fantacalcio** nel campo accanto (colonna `Id` del file quotazioni, oppure
     il numero finale dell'indirizzo `/listone/…` della scheda). Se invece il
     calciatore **ha lasciato la Serie A** dopo l'asta e non compare più nel
     listone, scegli nel menu **"fuori lista"**: entra in rosa come fuori lista
     e il manager lo svincola con un **cambio gratuito** recuperando il prezzo
     pagato (regolamento). Il ruolo si sceglie nel menu (P/D/C/A) oppure
     "ruolo dedotto": l'app lo ricava dal buco nella composizione 3/7/7/6
     della squadra e, se non è univoco, te lo chiede alla conferma.
     I nomi con `*` nel file che non sono nel listone sono già segnati
     "fuori lista" con ruolo dedotto.
     La casella **"Segna tutti i nomi non trovati come fuori lista"** sopra le
     squadre applica la scelta a tutte le righe in un colpo solo (utile a
     inizio stagione, quando i non trovati sono tutti calciatori partiti).
   - **già in rosa**: due righe della stessa squadra puntano allo stesso
     calciatore; indica l'Id giusto per la seconda.
     Il messaggio "N nomi non hanno una corrispondenza certa…" resta finché non
     hai risolto tutto.
6. Tocca **Conferma e sostituisci le rose** (in alto o in fondo alla pagina).
   Oppure **Annulla import**.
7. La pagina diventa **Rose importate** con **Squadre create**, **Squadre
   aggiornate**, **Giocatori assegnati**, **Fuori lista creati**.

Errori alla conferma: "Ci sono ancora N nomi da risolvere.", "Alcune squadre
non rispettano la composizione 3/7/7/6 o il file ha anomalie bloccanti.",
"Una squadra avrebbe crediti negativi.", "Un calciatore non esiste più nel
listone.". A sessione aperta il messaggio è il generico "Import non riuscito.
Riprova.": chiudi la sessione prima.

### 4.2 Cosa fa la conferma

- Le scelte manuali vengono "congelate" in un nuovo record di import, così il
  log dice esattamente cosa è stato applicato.
- Per ogni squadra nel file: se esiste (stesso nome, maiuscole ignorate), la
  rosa attuale viene **chiusa** (storico conservato) e **ricreata** dal file;
  se non esiste, viene **creata** con sigla automatica.
- **Crediti = budget iniziale (250) − totale speso**; il totale speso viene
  ricalcolato dai costi delle righe.
- **Cambi usati azzerati** a 0.
- Il **manager collegato resta collegato**.
- Le squadre **assenti dal file non vengono toccate**.
- I giocatori con `*` che esistono nel listone entrano in rosa con lo stato
  del listone (è il listone che comanda). Quelli **non presenti nel listone**
  e segnati fuori lista diventano calciatori "segnaposto": Id negativo,
  squadra "Fuori Serie A", Qt.A 0, stato fuori lista. Non sono mai svincolati
  acquistabili, non vengono toccati dagli import del listone, e si
  sostituiscono solo con il cambio gratuito (rimborso = prezzo pagato). Un
  re-import con lo stesso nome riusa lo stesso segnaposto.

È l'operazione di inizio stagione. Per correggere un singolo caso non
re-importare: usa le funzioni della pagina squadra (§5).

## 5. Gestione squadre

Pagina **Admin → Squadre e rose**. Sottotitolo: "N squadre · N senza manager
collegato". Tabella **Elenco squadre**: Squadra, Manager (badge rosso "da
collegare" se manca), Crediti, Rosa (x/23), Cambi.

### 5.1 Creare o modificare una squadra

- **Nuova squadra** (riquadro a destra): **Nome squadra**, **Sigla** (2–4
  lettere o cifre, vuota = automatica), **Colore 1**, **Colore 2** → **Crea
  squadra**. Ti porta alla pagina della squadra.
- Pagina squadra → **Dati squadra** → **Salva modifiche**.
- Nome e sigla devono essere unici ("Esiste già una squadra con questo nome.",
  "Sigla già usata da un'altra squadra.").
- Le squadre non si eliminano dall'app.

### 5.2 Crediti

Pagina squadra → **Crediti**: **Crediti residui** (numero intero ≥ 0) +
**Motivazione** → **Aggiorna crediti**. Imposta il valore assoluto, non la
differenza. La rettifica compare nel registro come "Crediti admin" con la
motivazione. Consentita anche a sessione aperta.

### 5.3 Collegare il manager

Pagina squadra → **Manager** → scegli l'**Utente** → **Collega manager**.
"— nessuno —" scollega. Un utente può gestire **una sola squadra**: se lo
colleghi a un'altra, viene scollegato dalla precedente. La lista mostra solo
gli utenti attivi. Finché non è collegato, il manager vede "Nessuna squadra
collegata" e non può fare cambi.

### 5.4 Assegnare o rimuovere giocatori (solo fuori sessione)

- **Aggiungi un calciatore**: scrivi il nome in **Calciatore** e scegli dalla
  lista (formato "Nome (R · Squadra · Qt.A)"); il **Prezzo** si precompila con
  la Qt.A ma puoi cambiarlo (es. prezzo d'asta). **Aggiungi** scala il prezzo
  dai crediti e registra "Assegnazione admin". Errori: "Crediti insufficienti
  per questo prezzo.", "Il calciatore è già in questa rosa.".
- **Rimuovere**: nella rosa in fondo alla pagina tocca l'icona cestino sulla
  riga, controlla il **rimborso** (precompilato con il prezzo pagato, puoi
  metterlo a 0) e tocca **Conferma**. Registra "Rimozione admin".
- Entrambe sono **rifiutate a sessione aperta** (il messaggio è il generico
  "Assegnazione non riuscita." / "Rimozione non riuscita."): durante la
  sessione si corregge solo con gli annullamenti (§8).
- Queste operazioni non toccano il contatore dei cambi e non controllano la
  composizione: sei tu a garantire 3/7/7/6.

## 6. Utenti

Pagina **Admin → Utenti**. Contatori: **Iscritti**, **Attivi**, **Admin**,
**Senza squadra**. Il riquadro **Manager da collegare** elenca i manager attivi
senza squadra: per collegarli vai in Squadre e rose (§5.3).

Tabella **Tutti gli utenti**: nome, email (visibile solo agli admin), data di
iscrizione, squadra, ruolo (Admin/Manager), stato (Attivo/Disattivato).

Azioni per riga:

- **Rendi admin** / **Rendi manager**: cambia il ruolo. Effetto immediato al
  prossimo caricamento di pagina.
- **Disattiva** / **Riattiva**: un account disattivato non può più entrare
  (vede "Account disattivato") e non può fare cambi nemmeno via API. La
  squadra **resta collegata** all'utente: se serve, collega un altro manager
  (§5.3). Riattivandolo torna tutto come prima.
- Sulla **tua** riga i due pulsanti sono disabilitati: non puoi toglierti il
  ruolo admin né disattivarti ("Non puoi togliere il ruolo admin a te
  stesso." / "Non puoi disattivare il tuo account."). Chiedi a un altro admin.

Non è possibile cancellare utenti, cambiare la loro email o resettare la loro
password dall'app: per la password il manager usa **Password dimenticata?**.

## 7. Sessioni di mercato

Pagina **Admin → Sessioni di mercato**: tabella **Tutte le sessioni**
(Sessione con "+N crediti", Apertura, Chiusura, Stato, Azioni) e riquadro
**Nuova sessione**.

Stati: **Programmata** → **Aperta** → **Chiusa**. Una sola sessione può
essere aperta alla volta.

### 7.1 Creare una sessione

1. **Nome** (es. "Sessione 1 (dopo la 3ª giornata)").
2. **Apertura** e **Chiusura** in **ora italiana**; la chiusura deve essere
   dopo l'apertura. Date impossibili vengono rifiutate.
3. **Budget extra all'apertura (crediti per squadra)**: precompilato con il
   valore delle Impostazioni (5). Viene copiato nella sessione: cambiare
   l'impostazione dopo non modifica le sessioni già create.
4. **Crea sessione**.

Modifiche: dalla pagina della sessione, riquadro **Dati sessione** → **Salva
modifiche**. Programmata: tutto modificabile. Aperta: nome e date (il budget
extra è già stato accreditato e resta bloccato). Chiusa: sola lettura.
**Elimina** (icona cestino) solo se Programmata.

### 7.2 Apertura (automatica all'orario, o "Apri ora")

La sessione **si apre da sola** all'orario di "Apertura": alla prima visita di
un qualsiasi utente (o al passaggio del cron notturno) dopo quell'ora l'app
esegue l'apertura. Non serve essere collegati. **Apri ora** serve per
anticipare: apre subito e sposta l'orario di apertura ad adesso.

Prima dell'orario:

1. Assicurati che il listone sia aggiornato (§3): i prezzi dei cambi sono la
   Qt.A dell'ultimo import.
2. Se vuoi aprire in anticipo tocca **Apri ora** (nella tabella o nella pagina
   della sessione). Messaggio: "Sessione aperta: svincolati fotografati e
   budget extra accreditato."

In un'unica transazione l'app: **fotografa gli svincolati** (calciatori attivi
non posseduti da nessuno in quel momento), **accredita il budget extra** a
tutte le squadre (una riga "Crediti admin · Budget extra apertura sessione"
per squadra, mai due volte per la stessa sessione) e porta lo stato ad
**Aperta**. Poi parte l'email "mercato aperto" (§9). Nell'audit log
l'apertura automatica è marcata `source: auto`.

Se due sessioni sono programmate nello stesso momento si apre la prima; la
seconda aspetta la chiusura della prima.

Errori di **Apri ora**: "C'è già una sessione aperta: chiudila prima.", "La
data di chiusura è già passata: modificala prima di aprire.", "La sessione
non è più programmata.".

### 7.3 Durante la sessione

- I manager fanno i cambi da **Mercato**; tu vedi tutto in **Registro
  operazioni** e nella pagina della sessione (**Operazioni della sessione**).
- Puoi ancora: rettificare crediti (§5.2), creare squadre, annullare
  operazioni (§8), spostare le date della sessione, importare il listone.
- Non puoi: assegnare/rimuovere giocatori a mano, importare le rose.
- Spostare **Chiusura** in avanti prolunga la sessione; indietro la accorcia.

### 7.4 Chiusura automatica e chiusura manuale

- **Allo scadere dell'orario di chiusura i cambi si bloccano** e, alla prima
  visita successiva di un qualsiasi utente (o al cron notturno), la sessione
  passa a **Chiusa**: le operazioni in sospeso diventano definitive (gli
  acquisti vengono contati nei 20), esce il report di validazione e parte
  l'email "mercato chiuso".
- Per chiudere prima dell'orario: **Chiudi sessione** → **Chiudi davvero**. La
  chiusura viene anticipata a adesso; i cambi già confermati restano validi.
- Una sessione chiusa non si riapre. Se serve altro tempo, crea una nuova
  sessione con budget extra **0** (altrimenti tutti riceverebbero altri +5).

### 7.5 Il report di chiusura

Nella pagina della sessione, riquadro **Report di chiusura** con badge
"tutte le rose sono regolari" oppure "N rose da sistemare". Per ogni squadra:
Giocatori (totale), Per ruolo (P/D/C/A), Fuori lista, Crediti, Esito **ok** o
**da sistemare**.

Una rosa è **ok** se ha 23 giocatori, composizione 3/7/7/6 **e nessun fuori
lista**. I crediti non possono essere negativi per costruzione, quindi non
generano mai un "da sistemare". Il nome della squadra è un link alla pagina
admin della squadra.

Cosa fare con le rose "da sistemare":

1. Fuori lista ancora in rosa → scrivi al manager: il cambio gratuito resta
   possibile anche a sessione chiusa.
2. Composizione o totale sbagliati (possibile solo dopo correzioni manuali o
   un import anomalo) → sistemali tu con **Aggiungi un calciatore** / cestino
   (§5.4), ora che la sessione è chiusa.

## 8. Registro operazioni e annullamenti

Pagina **Admin → Registro operazioni**: le ultime 200 operazioni di tutta la
lega (Quando, Squadra, Operazione, Dettaglio, Crediti, Azioni). Tipi:
Svincolo, Acquisto (badge "gratuito" se sostituisce un fuori lista), Svincolo
gratuito, Assegnazione admin, Rimozione admin, Crediti admin, Annullamento
(più Cambio e Cambio gratuito dello storico precedente). Le operazioni annullate restano visibili, in grigio, con il badge
"annullata". Lo stesso registro, senza azioni, è la **Bacheca mercato** dei
manager e l'export "Registro operazioni".

### 8.1 Annullare un'operazione

1. Sulla riga tocca **Annulla**.
2. Scrivi la **Motivazione** (almeno 3 caratteri, max 300): sarà visibile a
   tutta la lega nella Bacheca ("motivo: …").
3. **Conferma annullamento** → "Operazione annullata: creata l'operazione
   inversa."

L'annullamento **non cancella nulla**: crea un'operazione di tipo
"Annullamento" che:

- toglie dalla rosa il calciatore entrato;
- rimette in rosa il calciatore uscito **all'ultimo prezzo che aveva pagato**;
- inverte i crediti (segno opposto);
- se l'operazione contava nei 20 cambi, riporta indietro il contatore.

Vale per svincoli, acquisti, svincoli gratuiti, assegnazioni/rimozioni admin
e rettifiche crediti (incluso il budget extra di una sessione, una squadra
alla volta). È consentito anche a sessione aperta. Annullare uno svincolo
rimette il calciatore in rosa anche se nel frattempo il posto è stato
riempito: la rosa risulta "in più della regola" finché non annulli anche
l'acquisto o rimuovi qualcuno (§5.4).

### 8.2 Limiti

- **Non si annulla un annullamento** ("Non si può annullare un annullamento."):
  se hai sbagliato, rifai l'operazione a mano fuori sessione (§5.4) o chiedi
  al manager di rifare il cambio.
- Ogni operazione si annulla **al massimo una volta** ("Operazione già
  annullata.").
- **Ordine**: se il calciatore entrato è stato nel frattempo ceduto con un
  altro cambio, l'app risponde "Il calciatore entrato non è più in rosa:
  annulla prima le operazioni successive." Annulla partendo dalla più recente
  e risali.
- "Il calciatore uscito è già tornato in rosa." → il manager lo ha ricomprato:
  annulla prima quell'acquisto, oppure lascia stare.
- "Crediti insufficienti" → l'inversione porterebbe la squadra sotto zero
  (es. annullare un accredito già speso): rettifica prima i crediti (§5.2).

## 9. Email di lega

L'app manda tre email, un messaggio per destinatario (nessuno vede gli
indirizzi altrui). Le prime due vanno a **tutti i membri attivi**:

- **"SuperLega · mercato aperto: <nome sessione>"** all'apertura: scadenza,
  crediti extra accreditati, numero di svincolati, link a Mercato.
- **"SuperLega · mercato chiuso: <nome sessione>"** alla chiusura: cambi
  registrati, elenco delle rose da sistemare ("l'admin vi contatterà"), link
  alla Rosa.

La terza va **solo agli admin**:

- **"SuperLega · Cambio gratuito: <squadra>"** a ogni operazione gratuita del
  giro fuori lista: lo **svincolo gratuito** di chi ha lasciato la Serie A e
  l'**acquisto gratuito** che ne riempie il posto (quello che non consuma uno
  dei 20 cambi). Un'email per operazione, quindi due per un cambio completo.
  Dentro: squadra e manager, chi esce con il rimborso o chi entra con il
  costo, crediti residui, se l'operazione conta nei cambi stagionali, l'ora
  italiana e il link a **Registro operazioni**. Gli acquisti normali (a
  pagamento, in sessione) **non** mandano nulla.

Esempio del testo:

```
Svincolo gratuito (fuori lista) nella SuperLega.

Squadra: Real Gear Second — manager: Mario
Esce: Rui Patricio (Portiere) — rimborso 12 crediti
Crediti residui: 37
Conta nei cambi stagionali: no
Quando: 11/09/2026, 20:30 (ora italiana)

Registro operazioni: https://<app>/admin/operazioni
```

Per spegnerla: **Admin → Impostazioni lega → Regole → Automazioni**, casella
**"Email agli admin a ogni cambio gratuito"** → _Salva impostazioni_. La
casella "Email alla lega…" spegne invece tutte e tre.

L'invio parte **dopo** che l'operazione è già stata salvata: un
problema di posta **non annulla mai** né la sessione né il cambio. L'esito è in
**Admin → Impostazioni lega → Email inviate** (Quando, Oggetto, Destinatari,
Esito):

| Esito        | Significato                                                     |
| ------------ | --------------------------------------------------------------- |
| **Inviata**  | consegnata al provider per tutti i destinatari                  |
| **Parziale** | alcuni invii falliti (il dettaglio dice quanti e perché)        |
| **Fallita**  | nessun invio riuscito (errore nel dettaglio)                    |
| **Saltata**  | non è stato nemmeno tentato l'invio; il dettaglio spiega perché |

"Saltata" ha quattro cause: **Notifiche disattivate** (una delle due caselle
in Impostazioni), **Provider email non configurato** (manca `BREVO_API_KEY`
— o `RESEND_API_KEY` — nelle variabili d'ambiente: lo dice anche il
sottotitolo del riquadro, che quando è tutto a posto mostra il provider in
uso), **Limite invii raggiunto** (più di 5 email di lega in un'ora; i cambi
gratuiti hanno un contatore separato da 30 all'ora per manager, così una
raffica non fa sparire gli avvisi di sessione), **Nessun destinatario**.

Quando il provider rifiuta un invio, il dettaglio riporta **il suo messaggio
testuale**: `Brevo 400: Sender email is not valid…` significa che `EMAIL_FROM`
non è un mittente verificato sull'account Brevo (vedi `docs/DEPLOY.md` §2).

Se un'email è saltata o fallita, la sessione è comunque aperta/chiusa e il
cambio è comunque registrato: guarda il Registro operazioni e avvisa i manager
in chat. Non esiste un pulsante "reinvia".

## 10. Impostazioni lega

Pagina **Admin → Impostazioni lega**, riquadro **Regole** → **Salva
impostazioni**. Sono le regole del regolamento tradotte in numeri: **cambiale
solo se la lega decide così** (cambiano il comportamento descritto in
`docs/SPEC.md`). Valgono per le operazioni successive; quelle già registrate
non cambiano.

| Campo                                                                         | Cosa fa                                               | Note                                                             |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| **Budget iniziale**                                                           | crediti di partenza                                   | usato dall'import rose (crediti = budget − speso)                |
| **Budget extra per sessione**                                                 | accredito a ogni apertura                             | precompila le nuove sessioni; non tocca quelle esistenti         |
| **Cambi a stagione per squadra**                                              | limite dei cambi                                      | i cambi gratuiti non contano; vale subito anche per chi è a metà |
| **Operazioni al minuto per squadra**                                          | freno anti-abuso applicato dal database               | default 5; sopra il limite "Troppe operazioni in poco tempo"     |
| **Composizione della rosa** (Portieri, Difensori, Centrocampisti, Attaccanti) | 3/7/7/6                                               | usata da Rosa, import rose e report di chiusura                  |
| **Soglia variazioni quotazione**                                              | evidenzia in anteprima le variazioni di Qt.A ≥ soglia | solo informativa                                                 |
| **Aggiornamento automatico delle quotazioni**                                 | interruttore del sync giornaliero                     | uguale ad Attiva/Disattiva sync in Listone                       |
| **Email alla lega all'apertura e alla chiusura delle sessioni**               | interruttore notifiche                                | se spento **tutte** le email risultano "Saltata"                 |
| **Email agli admin a ogni cambio gratuito (fuori lista)**                     | interruttore del solo avviso ai cambi gratuiti        | §9; non tocca le email di sessione                               |

Tutti i numeri sono interi; valori fuori intervallo vengono rifiutati con un
messaggio sul campo. Le regole sui prezzi (rientro a Qt.A, rimborso fuori
lista a prezzo pagato) non sono modificabili dall'interfaccia.

## 11. Export Excel e backup

**Admin → Impostazioni lega → Export Excel**: tre file `.xlsx` scaricabili
con un tocco.

- **Rose e crediti**: foglio **Dettaglio** con una riga per calciatore in
  rosa (Squadra, Sigla, Id, Calciatore, R, Squadra Serie A, Qt.A, Prezzo
  pagato, Acquisito il, Come, Fuori lista), foglio **Squadre** (Manager,
  Crediti residui, Cambi usati, Giocatori) e foglio **ROSE** nello stesso
  layout dell'export "Rose" di Leghe Fantacalcio (squadre affiancate, nome e
  costo, `*` sui fuori lista, riga Totale): si può ricaricare altrove e anche
  re-importare qui (§4). Lo stesso file si scarica dalla pagina di ogni
  **sessione chiusa** ("Rose aggiornate").
- **Listone con quotazioni**: stesse intestazioni del file ufficiale più
  Stato, In quante rose, Aggiornato il (colonne che il parser ignora), quindi
  **si può re-importare** con l'import manuale (§3.1).
- **Registro operazioni**: l'intero registro (Quando, Squadra, Sessione,
  Operazione, Esce/Rientro, Entra/Costo, Delta crediti, Conta nel limite,
  Annullata, Note), comprese le annullate.

I file si chiamano `superlega-<tipo>-<data>.xlsx`.

Limite: 10 download ogni 10 minuti per admin.

Routine di backup consigliata (l'app non lo fa da sola):

1. Dopo l'import iniziale delle rose: scarica i tre file e conservali.
2. Prima di aprire e dopo aver chiuso ogni sessione: di nuovo i tre file.
3. Salvali in una cartella condivisa tra gli admin, con la data nel nome.
   Non contengono email né password.

I file Excel caricati negli import restano archiviati anche sul server, quando
l'archiviazione riesce (altrimenti l'anteprima lo segnala).

## 12. Audit log

**Admin → Audit log**: le ultime 300 voci, sola lettura (Quando, Chi, Azione,
Dettaglio). "Sistema" = azione senza utente (es. sync automatico); "Utente
rimosso" = account non più presente.

Azioni tracciate: Cambio ruolo, Attivazione account (anche le disattivazioni),
Cambio nome, Impostazione modificata, Anteprima import, Import applicato,
Import annullato, Rosa importata, Assegnazione giocatore, Rimozione giocatore,
Squadra creata/modificata, Manager collegato, Crediti modificati, Sessione
creata/modificata/eliminata/aperta/chiusa, Cambio, Cambio gratuito,
Annullamento, Email inviata.

Usalo per rispondere a "chi ha fatto questa modifica?"; per i dettagli
economici di un'operazione usa il Registro operazioni.

## 13. Cosa l'app non permette (riepilogo)

- Scambi di calciatori tra squadre: mai (regolamento).
- Cambi fuori sessione, tranne il cambio gratuito per i fuori lista.
- Crediti negativi, rosa oltre i limiti di ruolo, più di 20 cambi: rifiutati
  dal database anche via API.
- Assegnare/rimuovere giocatori a mano o importare rose **a sessione aperta**.
- Aprire due sessioni insieme; riaprire una sessione chiusa; eliminare una
  sessione aperta o chiusa.
- Cancellare calciatori, operazioni, squadre o utenti.
- Annullare un annullamento; annullare due volte la stessa operazione.
- Disattivare o declassare se stessi.
- Modificare i prezzi di un cambio: sono sempre la Qt.A dell'ultimo listone.

## 14. Checklist di inizio stagione

1. **Codice lega** (§2): impostane uno nuovo e comunicalo ai manager.
2. **Importa il listone** (§3.1) con il file quotazioni aggiornato; controlla
   "Calciatori attivi" e il foglio Ceduti.
3. **Importa le rose** (§4) dall'export "Rose" di Leghe Fantacalcio; risolvi
   omonimi e non trovati; verifica che ogni squadra mostri "3/7/7/6 ok" e
   crediti residui coerenti con il sito.
4. **Utenti** (§6): aspetta che i 20 manager si registrino e confermino
   l'email; promuovi gli altri admin.
5. **Collega i manager** (§5.3) finché "senza manager collegato" è 0.
6. **Impostazioni** (§10): budget 250, extra 5, cambi 20, 3/7/7/6, notifiche
   attive; verifica che il provider email risulti configurato.
7. **Backup** (§11): scarica i tre export.
8. **Sessione di prova**: crea una sessione con budget extra **0** e chiusura
   tra pochi minuti, aprila, fai un cambio con una squadra di test (o la tua),
   annullalo con motivazione, chiudi e leggi il report. Controlla che l'email
   risulti "Inviata". Poi crea le 4 sessioni reali come Programmate.

## 15. Checklist per ogni sessione

**Prima**

1. Importa il listone aggiornato (§3.1): i prezzi dei cambi sono la Qt.A di
   questo import. Leggi il banner dei fuori lista.
2. Verifica la sessione: nome, apertura, chiusura (giovedì 20:00 da
   regolamento), budget extra 5.
3. Backup rapido (§11).

**Apri**

4. All'ora stabilita tocca **Apri ora** e controlla il messaggio di conferma
   e il contatore "Svincolati (foto)" nella pagina della sessione.
5. Verifica in Impostazioni → Email inviate che "mercato aperto" sia Inviata;
   altrimenti avvisa in chat.

**Durante**

6. Tieni d'occhio **Registro operazioni** (o la Bacheca): errori segnalati dai
   manager si correggono con l'annullamento (§8), mai a mano.
7. Se serve, sposta la chiusura dalla pagina della sessione.

**Chiudi**

8. Dopo lo scadere dell'orario (i cambi sono già bloccati) tocca **Chiudi
   sessione → Chiudi davvero**.
9. Leggi il **Report di chiusura**: per ogni "da sistemare" contatta il
   manager (fuori lista → cambio gratuito) o correggi tu (§5.4).
10. Controlla l'email "mercato chiuso" e fai il backup (§11).
