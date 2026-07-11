# Neon Fortune Casino

Casino multiplayer 2D pixel-art con lobby private e sincronizzazione WebSocket.

## Avvio locale

```bash
npm install
npm start
```

Apri `http://localhost:3000` in due finestre, crea una lobby nella prima e usa il codice nella seconda.

## Pubblicazione su Render

1. Crea un repository GitHub e carica tutti i file del progetto.
2. Su Render scegli **New > Blueprint** e collega il repository.
3. Render leggerà `render.yaml`; conferma la creazione del servizio.
4. Al termine del deploy apri l'URL pubblico assegnato da Render.

Il server HTTP e il server WebSocket usano la stessa porta, quindi non servono variabili d'ambiente aggiuntive.
