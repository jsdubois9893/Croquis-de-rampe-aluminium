# Croquis de rampe — application Web/PWA

Application autonome en français pour créer un croquis de rampe sur téléphone, tablette ou ordinateur.

## Fonctions incluses

- renseignements du client et du chantier;
- dimensions, configuration, matériau et notes;
- dessin tactile avec crayon, ligne, flèche, texte et gomme;
- annuler/rétablir, grille et choix du trait;
- sauvegarde automatique locale dans le navigateur;
- écran de finalisation sans perte des informations ni du dessin;
- retour au croquis pour continuer les modifications;
- téléchargement du dessin en PNG et impression/enregistrement PDF;
- installation comme PWA et fonctionnement hors ligne après la première visite.

## Mise en ligne gratuite avec GitHub Pages

1. Créez un dépôt GitHub public, par exemple `croquis-rampe`.
2. Décompressez l’archive et téléversez **le contenu** de ce dossier à la racine du dépôt. `index.html` doit être directement à la racine.
3. Dans le dépôt, ouvrez **Settings > Pages**.
4. Dans **Build and deployment**, choisissez **Deploy from a branch**.
5. Sélectionnez la branche **main**, le dossier **/ (root)**, puis cliquez sur **Save**.
6. Ouvrez l’adresse fournie par GitHub Pages.

## Installation sur un appareil

- **iPhone/iPad :** ouvrir le site dans Safari, toucher Partager, puis **Ajouter à l’écran d’accueil**.
- **Android :** ouvrir le site dans Chrome, puis utiliser **Installer l’application** ou **Ajouter à l’écran d’accueil**.

## Données et confidentialité

Les données sont conservées uniquement dans le stockage local du navigateur de l’appareil. Elles ne sont pas envoyées vers un serveur. Effacer les données du navigateur, changer d’appareil ou utiliser un autre navigateur ne transfère pas les croquis.

## Mise à jour

Remplacez les fichiers du dépôt par la nouvelle version. Si vous modifiez les fichiers mis en cache, changez la valeur `CACHE_NAME` dans `service-worker.js` pour forcer la mise à jour hors ligne.

## Structure

- `index.html` — interface;
- `styles.css` — présentation responsive et impression;
- `app.js` — dessin, sauvegarde, finalisation et export;
- `manifest.webmanifest` — paramètres d’installation;
- `service-worker.js` — cache hors ligne;
- `offline.html` — page de secours;
- `icons/` — icônes de l’application;
- `.nojekyll` — indique à GitHub Pages de servir les fichiers tels quels.
