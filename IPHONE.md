# Ruta DSD en iPhone

Dos caminos. El A es inmediato y gratis; el B es la app nativa en TestFlight.

## A) App web instalable (hoy, sin cuenta Apple Developer)
1. Sube esta carpeta a un repositorio de GitHub (el `.gitignore` ya deja fuera las fotos de prueba).
2. En GitHub: Settings > Pages > Source: **GitHub Actions**.
3. Actions > **Web (GitHub Pages)** > Run workflow. Al terminar te da un link `https://TU-USUARIO.github.io/REPO/`.
4. En cada iPhone, en **Safari**: abre el link > Compartir > **Añadir a pantalla de inicio**.
   (Las páginas de GitHub Pages en repos privados necesitan plan de pago; en uno público el código es visible.)

## B) App nativa en TestFlight (varios iPhone, hasta 10 000 testers)
Requisitos que solo tú puedes hacer (son tus credenciales):
1. Cuenta **Apple Developer** (99 USD/año) en developer.apple.com.
2. En App Store Connect > Apps > **+** > Nueva app. Bundle ID: `com.rivmar.rutadsd` (créalo antes en Certificates, Identifiers & Profiles > Identifiers).
3. Certificado **Apple Distribution** (.p12 con contraseña) y perfil de aprovisionamiento **App Store** para ese Bundle ID (.mobileprovision).
4. App Store Connect > Users and Access > Integrations > **API Key** (rol App Manager): descarga el `.p8`, anota Key ID e Issuer ID.
5. En GitHub: Settings > Secrets and variables > Actions, crea:

| Secreto | Valor |
|---|---|
| `APPLE_TEAM_ID` | Team ID (10 caracteres) |
| `IOS_CERT_P12_BASE64` | el .p12 en base64 |
| `IOS_CERT_PASSWORD` | contraseña del .p12 |
| `IOS_PROFILE_BASE64` | el .mobileprovision en base64 |
| `ASC_KEY_ID` | Key ID de la API key |
| `ASC_ISSUER_ID` | Issuer ID |
| `ASC_KEY_P8_BASE64` | el .p8 en base64 |

   En Windows, base64: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("archivo.p12")) | Set-Clipboard`

6. Actions > **iOS TestFlight** > Run workflow. Tarda ~15 min; el build aparece en App Store Connect > TestFlight.
7. Agrega testers (por correo o link público) y ellos instalan con la app **TestFlight**.

Notas
- En iPhone el lector es el escáner de documentos de Apple + Tesseract (no hay ML Kit en iOS); sin la PC es más lento.
- Probar primero en un solo iPhone: el escáner nativo en iOS aún no se ha probado con fotos reales.
