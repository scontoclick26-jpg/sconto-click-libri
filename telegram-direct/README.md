# ScontoLibri Telegram bot — inserimento guidato

Bot indipendente per creare e pubblicare post nel canale ScontoLibri. Non usa Make, Cloudinary o il bot già operativo.

## Uso

Apri @ScontoLibriTestBot e invia `/pubblica`. Il bot chiede un dato alla volta:

1. Link Amazon affiliato
2. Titolo del libro
3. Ebook Kindle: sì/no
4. Valutazione (es. `49` = 4,9)
5. Numero recensioni (es. `1250` = 1.250)
6. Prezzo attuale (es. `31,28`)
7. Prezzo precedente oppure `-` se assente
8. Link alla panoramica

Il bot recupera la copertina dalla pagina Amazon e mostra un'anteprima. Il post viene inviato al canale soltanto dopo aver premuto **Pubblica nel canale**. `/annulla` interrompe l'inserimento.

Il post segue il formato ScontoLibri:
- 📲 Ebook Kindle solo per gli ebook
- Titolo e valutazione/recensioni
- 🔎 Di cosa si tratta? collegato alla panoramica
- Prezzo con eventuale percentuale di sconto
- #adv
- Pulsante 🛒 VAI ALL’OFFERTA collegato al link affiliato

Se Amazon impedisce il recupero della copertina, il bot mostra l'anteprima testuale e consente comunque la pubblicazione senza immagine.

## Deploy su Render

Crea un nuovo Web Service usando:
- Repository: `scontoclick26-jpg/sconto-click-libri`
- Branch: `telegram-direct-test`
- Root directory: `telegram-direct`
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`

Imposta le variabili d'ambiente su Render:
- `BOT_TOKEN`: token di @ScontoLibriTestBot (solo su Render, mai su GitHub o in chat)
- `ALLOWED_USER_ID`: ID numerico Telegram dell'utente autorizzato
- `WEBHOOK_SECRET`: stringa casuale di almeno 32 caratteri, solo lettere, numeri, trattini e underscore
- `PUBLIC_URL`: URL HTTPS del servizio Render, senza slash finale (oppure lascia che Render fornisca `RENDER_EXTERNAL_URL`)
- `CHANNEL_ID`: username pubblico del canale (es. `@nomecanale`) oppure ID numerico del canale

Aggiungi @ScontoLibriTestBot al canale ScontoLibri come amministratore con il permesso di pubblicare messaggi. Il bot non può pubblicare finché questo passaggio non è completato.

## Sicurezza e isolamento

- Il bot risponde soltanto all'ID Telegram indicato in `ALLOWED_USER_ID` e solo in chat privata.
- Token e segreti non devono mai essere inseriti nei file del repository.
- Il codice è nel branch separato `telegram-direct-test`; non modifica il bot esistente né gli scenari Make.
- Le sessioni di inserimento sono mantenute in memoria: un riavvio del servizio interrompe l'eventuale inserimento in corso.
- Il piano gratuito Render può sospendere il servizio dopo inattività e ritardare la prima risposta.
