# Script Sirene `/siret`

Petit script TypeScript pour interroger facilement l'API Sirene (`https://api.insee.fr/api-sirene/3.11`) sur le endpoint `/siret`, gérer automatiquement la pagination par curseur et rassembler tous les établissements dans un fichier JSON unique.

## Pré-requis

1. Node.js 18+
2. Dépendances installées :
   ```bash
   npm install
   ```
3. Une clé API INSEE (header `X-INSEE-Api-Key-Integration`). Deux options :
   - Exporter la variable dans votre shell : `export SIRENE_API_KEY="votre_token"`
   - ou créer un fichier `.env` à la racine avec `SIRENE_API_KEY=votre_token`
   - (compatibilité : la variable `SIRENE_API_TOKEN` continue de fonctionner si vous l'avez déjà configurée)

## Configuration des paramètres

Ouvrez `src/fetchSirene.ts` et ajustez l'objet `QUERY_PARAMS` pour refléter exactement les paramètres que vous envoyez habituellement (par ex. `q`, `champs`, `nombre`, etc.). Ajoutez ou supprimez des champs librement : ils seront transmis tels quels à l'API.

## Exécution

```bash
npm run fetch
```

Le script va :
- Lancer une première requête avec `curseur=*`
- Boucler automatiquement tant que `curseurSuivant` reste différent du curseur envoyé
- Agréger tous les éléments retournés dans `etablissements`
- Respecter une pause de 5 secondes entre chaque requête (modifiable via `REQUEST_INTERVAL_MS` dans `src/fetchSirene.ts`) pour éviter le rate limiting
- Écrire le résultat complet dans `etablissements.json`

## Résultat

Le fichier `etablissements.json` (créé à la racine du projet) contient un tableau avec l'ensemble des établissements correspondant à la requête.
