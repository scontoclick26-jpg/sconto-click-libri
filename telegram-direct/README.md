# ScontoLibri Telegram bot (test)

Bot separato per provare la pubblicazione diretta su Telegram, senza Make e senza Cloudinary. La copertina viene letta dalla pagina Amazon e inviata a Telegram come URL.

## Comando

Invia al bot, in chat privata:

\`\`\`text
/pubblica
https://www.amazon.it/dp/ASIN
Titolo del libro
31,28
44,90
49
1250
https://link-della-panoramica
\`\`\`

Per un ebook Kindle, aggiungi la riga \`📲 Ebook Kindle\` subito dopo \`/pubblica\`.

- Prezzo attuale e prezzo precedente: usa la virgola per i decimali.
- Se non c'è un prezzo precedente, lascia vuota la riga (mantieni comunque la riga vuota nel messaggio).
- Valutazione: \`49\` significa 4,9.
- Recensioni: \`1250\` viene visualizzato come 1.250.

## Deploy su Render

Crea un nuovo Web Service da questo repository, branch \`telegram-direct-test\`, root directory \`telegram-direct\`. Puoi usare il file \`render.yaml\` come riferimento.

Imposta queste variabili d'ambiente su Render:
- \`BOT_TOKEN\`: token del NUOVO bot creato con @BotFather.
- \`ALLOWED_USER_ID\`: ID numerico Telegram dell'utente autorizzato.
- \`WEBHOOK_SECRET\`: stringa casuale di almeno 32 caratteri, solo lettere, numeri, trattini e underscore.
- \`PUBLIC_URL\`: URL HTTPS pubblico del servizio Render, senza slash finale.

Il server configura automaticamente il webhook Telegram all'avvio. Non inserire mai token o segreti nei file GitHub.

## Note

- Il bot accetta solo messaggi privati dall'ID autorizzato.
- Il bot pubblica solo nella chat privata di test: non invia nulla al canale.
- La copertina Amazon viene recuperata dalla pagina prodotto. Amazon può limitare le richieste automatiche; in quel caso il bot segnala che non ha trovato la copertina.
- Il piano gratuito Render può sospendere il servizio dopo inattività e il risveglio può ritardare la risposta. È adatto ai test, non garantisce disponibilità continua.
- Usa un bot Telegram nuovo: un bot già collegato al webhook di Make non può ricevere contemporaneamente gli stessi aggiornamenti su un secondo servizio.
