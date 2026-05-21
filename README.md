# Data & AI News Feed

Statischer News-Feed mit täglicher automatischer Aktualisierung via GitHub Actions.

## Funktionsweise

- GitHub Actions ruft täglich um 06:00 Uhr UTC RSS-Feeds ab
- Titel und Beschreibungen werden mit der MyMemory API kostenlos ins Deutsche übersetzt
- Kein API Key, keine Registrierung, keine Kreditkarte notwendig
- Ergebnisse werden als datierte JSON-Dateien in `public/news/` gespeichert
- GitHub Pages hostet das Frontend — komplett statisch, kein Backend
- Artikel werden 6 Monate archiviert, ältere Dateien automatisch gelöscht

---

## Einrichtung

### Voraussetzungen

- GitHub Account (kostenlos)
- Sonst nichts — die Übersetzung läuft über MyMemory, komplett kostenlos ohne Account

### Schritt 1 – GitHub Repository erstellen

1. Neues **öffentliches** Repository auf GitHub anlegen (public ist Pflicht für kostenloses GitHub Pages)
2. Alle Dateien in das Repository pushen

### Schritt 2 – GitHub Pages aktivieren

1. Repository → **Settings** → **Pages**
2. Source: **GitHub Actions** auswählen
3. Speichern

### Schritt 3 – Ersten Workflow-Lauf starten

1. Repository → **Actions** → **Daily News Fetch**
2. **Run workflow** → **Run workflow** (grüner Button)
3. Nach ca. 1–2 Minuten ist der erste Lauf fertig

### Schritt 4 – Website aufrufen

```
https://DEIN-USERNAME.github.io/REPO-NAME/
```

---

## Lokale Entwicklung

```bash
# Dependencies installieren
npm install

# .env Datei anlegen (wird nie committet)
cp .env.example .env
# DEEPL_API_KEY in .env eintragen

# Script manuell ausführen
npm run fetch
```

---

## Tägliche Aktualisierung

- **Automatisch**: jeden Morgen um **06:00 Uhr UTC** (= 08:00 Uhr deutsche Zeit, Winterzeit +1h)
- **Manuell**: GitHub → Actions → "Daily News Fetch" → Run workflow

---

## Archiv

- Artikel werden automatisch **6 Monate (180 Tage)** aufbewahrt
- Ältere Dateien werden täglich automatisch gelöscht
- Über den **Datepicker** rechts oben kann jeder archivierte Tag aufgerufen werden

---

## Kollegen einladen

Einfach die GitHub Pages URL teilen — kein Login, kein Passwort notwendig.

---

## Kosten

| Komponente | Kosten |
|---|---|
| GitHub + GitHub Pages + Actions | 0 € |
| MyMemory Übersetzung (~5.700 Zeichen/Tag von 10.000 Limit) | 0 € |
| Hosting | 0 € |
| **Gesamt** | **0 €/Monat** |

---

## Projektstruktur

```
├── index.html              # Frontend-Einstiegspunkt
├── style.css               # Styles
├── app.js                  # Frontend-Logik
├── public/
│   └── news/
│       ├── index.json      # Liste aller verfügbaren Daten
│       └── YYYY-MM-DD.json # Tägliche News-Dateien
├── scripts/
│   └── fetch-news.js       # RSS-Fetch + DeepL-Übersetzung + Archiv-Verwaltung
├── package.json
├── .github/
│   └── workflows/
│       └── fetch-news.yml  # GitHub Actions Workflow
├── .gitignore
└── .env.example
```

---

## Sicherheit

- **Kein API Key** notwendig — MyMemory funktioniert ohne jede Authentifizierung
- Das Frontend macht **keine** externen API-Calls — es liest nur statische JSON-Dateien
- Die Übersetzung findet ausschließlich im GitHub Actions Workflow statt (serverseitig)
