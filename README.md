# Croquis de rampe aluminium — version 2.1

Cette version ajoute une **sauvegarde locale complète** à l’application Web/PWA.

## Fonctions de sauvegarde ajoutées

- **Enregistrer le croquis** avec un nom obligatoire.
- **Mes croquis** : liste locale avec vignette, client, chantier, section et date de modification.
- Recherche et tri des croquis.
- Rouvrir et modifier un croquis existant.
- Dupliquer un croquis.
- Supprimer un croquis avec confirmation.
- Brouillon automatique pendant le travail.
- Sauvegarde automatique d’un croquis déjà nommé.
- Exporter tous les croquis dans un fichier de sauvegarde `.json`.
- Importer une sauvegarde `.json` sur le même appareil ou un autre appareil.
- Demande de stockage durable au navigateur lorsque cette fonction est offerte.
- Fonctionnement hors ligne après une première ouverture en ligne.

Chaque croquis conserve :

- nom du croquis, client, date, chantier, adresse et section;
- couleur, matériau et configuration;
- toutes les mesures personnalisées;
- notes;
- dessin complet, annotations, couleurs et épaisseurs;
- date de création, date de modification et révision.

## Important — où sont les données?

Les données sont enregistrées dans **IndexedDB sur l’appareil et dans le navigateur/PWA utilisés**. Aucun croquis n’est envoyé sur Internet.

Un croquis enregistré sur une tablette ne se retrouve donc pas automatiquement sur un téléphone. Pour le transférer :

1. ouvrir **Mes croquis**;
2. choisir **Exporter une sauvegarde**;
3. transférer le fichier `.json`;
4. choisir **Importer** sur l’autre appareil.

Ne supprimez pas les données du site dans le navigateur sans avoir exporté une sauvegarde. La désinstallation de l’application ou le nettoyage des données du navigateur peut supprimer les croquis locaux.

## Remplacer la version actuelle sur GitHub Pages

1. Décompressez l’archive fournie.
2. Ouvrez le dépôt GitHub `Croquis-de-rampe-aluminium`.
3. Choisissez **Add file → Upload files**.
4. Téléversez **tout le contenu de ce dossier**, y compris `icons` et `.nojekyll`, à la racine du dépôt.
5. Remplacez les anciens fichiers lorsque GitHub le demande.
6. Au bas de la page, choisissez **Commit changes**.
7. Attendez la republication de GitHub Pages, puis rechargez l’application.

Si l’ancienne version demeure visible, fermez complètement la PWA, rouvrez-la et actualisez la page. Le nouveau service worker porte le cache `croquis-rampe-v2.1.0`.

## Structure prête pour SharePoint

Le format local utilise un identifiant stable, une version de schéma, un numéro de révision et un objet `sync` :

```json
{
  "schemaVersion": 2,
  "id": "identifiant-unique",
  "title": "Nom du croquis",
  "createdAt": "date ISO",
  "updatedAt": "date ISO",
  "revision": 1,
  "data": {
    "form": {},
    "measurements": [],
    "drawing": { "actions": [] }
  },
  "sync": {
    "state": "local-only",
    "sharePointItemId": null,
    "lastSyncedAt": null,
    "localRevision": 1
  }
}
```

Cette structure facilitera l’ajout ultérieur d’une liste ou bibliothèque SharePoint sans devoir modifier le contenu des croquis existants.

## Fichiers

- `index.html` — interface de l’application
- `styles.css` — mise en page téléphone, tablette, ordinateur et impression
- `app.js` — dessin, formulaires, bibliothèque et automatisation
- `storage.js` — IndexedDB, brouillon, import/export et format des données
- `manifest.webmanifest` — installation PWA
- `service-worker.js` — utilisation hors ligne
- `offline.html` — page de secours
- `icons/` — icônes et image de remplacement
- `.nojekyll` — publication GitHub Pages

## Vérification rapide après la mise à jour

1. Créer un croquis et dessiner quelques traits.
2. Ajouter une mesure et des notes.
3. Enregistrer sous un nom.
4. Fermer et rouvrir l’application.
5. Ouvrir **Mes croquis**, puis rouvrir le croquis.
6. Modifier le dessin et attendre l’indication **Sauvegarde auto**.
7. Dupliquer, rechercher puis supprimer la copie.
8. Exporter une sauvegarde JSON et la réimporter.
9. Passer en mode avion et vérifier que l’application s’ouvre toujours.
