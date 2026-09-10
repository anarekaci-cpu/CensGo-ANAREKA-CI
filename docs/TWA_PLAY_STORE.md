# Publier CensGo sur le Google Play Store (TWA)

CensGo est une PWA. Pour la publier sur le Play Store on l'emballe dans une
**Trusted Web Activity (TWA)** : une coquille Android qui ouvre le site en
plein écran, sans barre d'URL, à condition que le site prouve qu'il
« appartient » à l'app via **Digital Asset Links**.

---

## 1. Pré-requis : où doit vivre `assetlinks.json`

Android exige le fichier à l'adresse **exacte** :

```
https://<domaine>/.well-known/assetlinks.json
```

⚠️ **À la RACINE du domaine**, jamais sous un sous-chemin.

Le site est actuellement servi sur un *project site* GitHub Pages :
`https://anarekaci-cpu.github.io/CensGo-ANAREKA-CI/`
→ le fichier de ce dépôt se retrouve à
`https://anarekaci-cpu.github.io/CensGo-ANAREKA-CI/.well-known/assetlinks.json`
**ce qui ne sera pas reconnu par Android.**

### Options (au choix)

| Option | Ce qu'il faut faire |
| --- | --- |
| **A. Domaine personnalisé (recommandé)** | Pointer p.ex. `censgo.anareka.ci` vers GitHub Pages (`CNAME`), régler `start_url`/`scope`/`base` sur ce domaine. `assetlinks.json` sera alors servi à la racine automatiquement (ce fichier `public/.well-known/`). |
| **B. Repo racine `anarekaci-cpu.github.io`** | Créer/utiliser le dépôt `anarekaci-cpu.github.io` et y déposer `/.well-known/assetlinks.json`. Le site CensGo peut rester sur son sous-chemin, seul l'asset link migre à la racine. |
| **C. Autre hébergeur** (Netlify, Cloudflare Pages, Vercel) | Sert nativement `/.well-known/` à la racine ; adapter `base` dans `vite.config.js`. |

Tant qu'aucune de ces options n'est en place, la TWA ouvrira le site **avec
la barre d'adresse Chrome visible** (mode « custom tab »), fonctionnel mais
pas « app-like ».

---

## 2. Renseigner `public/.well-known/assetlinks.json`

Deux valeurs à remplir :

- `package_name` : l'identifiant de l'app Android. Proposé : `ci.anareka.censgo`
  (à garder identique partout : Bubblewrap, Play Console, ce fichier).
- `sha256_cert_fingerprints` : l'empreinte SHA-256 de la **clé de signature
  de l'app**.
  - Si tu utilises **Play App Signing** (par défaut sur le Play Store) :
    Play Console → ton app → *Release* → *Setup* → *App signing* →
    « SHA-256 certificate fingerprint ». C'est **celle-là** qu'il faut
    (pas celle de ton upload key).
  - En local, pour ta clé d'upload :
    `keytool -list -v -keystore chemin/vers/upload.keystore -alias <alias>`

On peut lister **plusieurs** empreintes (upload key + Play signing key) dans
le tableau, séparées par des virgules.

---

## 3. Générer la TWA

### Avec Bubblewrap (CLI Google)

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://<domaine>/CensGo-ANAREKA-CI/manifest.webmanifest
# répondre : applicationId = ci.anareka.censgo, host = <domaine>, etc.
bubblewrap build      # produit app-release-signed.aab + app-release-signed.apk
```

Bubblewrap génère aussi un `assetlinks.json` prêt à copier — comparer avec
celui de ce dépôt et aligner `package_name` / fingerprint.

### Avec PWABuilder (web)

1. https://www.pwabuilder.com/ → coller l'URL du site.
2. Onglet **Android** → *Generate Package* → choisir *Trusted Web Activity*.
3. Renseigner Package ID `ci.anareka.censgo`.
4. Télécharger le zip : il contient le `.aab` **et** un `assetlinks.json`
   avec l'empreinte de la clé générée — la déposer à la racine du domaine.

---

## 4. Vérifier

```bash
# le fichier est bien servi, en JSON, à la racine
curl -s https://<domaine>/.well-known/assetlinks.json | jq .

# validateur officiel Google
# https://developers.google.com/digital-asset-links/tools/generator
```

Sur l'appareil : installer l'AAB via Play (interne/test), ouvrir l'app —
si les asset links sont bons, **aucune barre d'URL** n'apparaît.

---

## 5. Play Console — infos de fiche

- **Nom** : CensGo — Recensement ANAREKA-CI
- **Description courte** : Recensement terrain des restaurateurs, kiosques
  d'attiéké et vendeurs ambulants en Côte d'Ivoire.
- **Catégorie** : Outils / Productivité.
- **Icône** : `public/icon-512.png` (512×512) ; bannière 1024×500 à produire.
- **Politique de confidentialité** : URL obligatoire (l'app gère des données
  personnelles de tiers recensés — prévoir une page dédiée).
- **Data safety** : déclarer la collecte (nom, téléphone, adresse,
  localisation) et le chiffrement en transit (HTTPS + Supabase RLS).

---

## 6. Rappels

- `manifest.webmanifest` : `display: standalone`, `start_url` et `scope`
  cohérents avec le domaine de prod (voir `vite.config.js`).
- Icône **maskable** présente (`icon-512-maskable.png`) — requise pour un
  rendu correct de l'icône adaptative Android.
- Après tout changement de clé de signature (perte de keystore, migration
  Play App Signing), **mettre à jour l'empreinte** dans `assetlinks.json`
  et redéployer, sinon la TWA repasse en mode barre d'URL.
