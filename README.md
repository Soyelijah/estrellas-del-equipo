# Estrellas del Equipo

Aplicación full-stack para evaluaciones privadas del equipo y una distribución
transparente de propinas. Se ejecuta con
[vinext](https://github.com/cloudflare/vinext), Cloudflare D1 y Drizzle.

## Requisitos previos

- Node.js `>=22.13.0`
- Linux con `flock`, `curl` y `timeout` de GNU

## Ciclo de vida de Sites

La CLI del ciclo de vida de Sites instala las dependencias bloqueadas antes de entregar este checkout. Edita el código en `app/` y crea un punto de control cuando haya un hito coherente para inspeccionar o compartir. El constructor remoto de Sites ejecuta `npm run build` sobre el commit enviado. No repitas la instalación ni la compilación como paso normal antes de crear un punto de control.

La configuración local de Cloudflare está en `wrangler.jsonc`: apunta al Worker
`worker/index.ts` y declara el binding D1 `DB`.

`install:ci` ejecuta intencionadamente un único `npm ci`, sin reintentos. Rechaza instalaciones simultáneas del mismo proyecto, usa con `--prefer-offline` una caché de npm incluida en la imagen cuando coincide y mantiene la alternativa del registro para objetos ausentes; si no existe caché, descarga y verifica el archivo completo de vinext registrado en `package-lock.json`, limita npm a un socket y termina una instalación bloqueada. `build` aplica un tiempo de espera breve y luego valida el artefacto de Sites. Estos ayudantes son para Linux y usan `timeout` de GNU; no son scripts nativos de macOS.

Los scripts que necesitan directorios escribibles de inicio, npm, XDG y temporales delimitados al proyecto usan `scripts/sites-env.sh`. Los scripts `dev` y `start` respetan el entorno de ejecución del invocador y mantienen los registros de Wrangler dentro del checkout. El directorio generado `.sites-runtime/` es descartable y Git lo ignora.

## Estructura incluida

- la interfaz vive en `app/`
- las reglas de dominio y los controladores HTTP viven en `domain/` y `server/`
- `worker/index.ts` conecta las rutas API, D1 y el runtime de vinext
- `drizzle/` contiene las migraciones versionadas de D1
- `app/chatgpt-auth.ts` ofrece ayudantes opcionales de inicio de sesión de ChatGPT administrado por Dispatch
- `.openai/hosting.json` declara bindings opcionales de Sites para D1 y R2
- `vite.config.ts` simula los bindings declarados para el desarrollo local
- `db/index.ts` lee el binding D1 desde el entorno del Worker de Cloudflare
- `db/schema.ts` define el esquema de datos de la aplicación
- `examples/d1/` contiene una superficie de ejemplo opcional para D1
- `drizzle.config.ts` permite generar migraciones locales cuando sea necesario

## Aviso para implementaciones locales

Si este repositorio ya está instalado en otro entorno local, revisa
[`docs/LOCAL_IMPLEMENTATION_NOTICE.md`](docs/LOCAL_IMPLEMENTATION_NOTICE.md)
antes de desplegar: incluye los pasos para actualizar el checkout, validar las
migraciones y comprobar el cambio de seguridad de los verbos HTTP.

## Cabeceras de autenticación del espacio de trabajo

Los sitios de espacio de trabajo de OpenAI pueden leer el correo de la persona
usuaria actual desde
`oai-authenticated-user-email`.

Los sitios de espacio de trabajo autenticados con SIWC también pueden recibir
`oai-authenticated-user-full-name` cuando el perfil SIWC de la persona usuaria
tiene un claim `name` no vacío. El valor del nombre completo está codificado en
UTF-8 con porcentaje y viene acompañado de
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Trata el nombre completo como opcional y usa el correo como alternativa si no
está presente:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Inicio de sesión opcional de ChatGPT administrado por Dispatch

Importa los ayudantes listos para usar desde `app/chatgpt-auth.ts` cuando el
sitio necesite inicio de sesión opcional u obligatorio con ChatGPT:

- Usa `getChatGPTUser()` para una interfaz con inicio de sesión opcional.
- Usa `requireChatGPTUser(returnTo)` en páginas renderizadas en el servidor que
  deban redirigir visitantes anónimos mediante «Iniciar sesión con ChatGPT».
- Usa `chatGPTSignInPath(returnTo)` y `chatGPTSignOutPath(returnTo)` para
  enlaces o acciones del navegador.
- Pasa una ruta relativa `returnTo` del mismo origen como destino posterior al
  inicio o cierre de sesión. El ayudante la valida y codifica de forma segura.
- Marca las páginas protegidas con `export const dynamic = "force-dynamic"`,
  porque dependen de cabeceras de identidad por solicitud.

Dispatch administra `/signin-with-chatgpt`, `/signout-with-chatgpt`,
`/callback`, las cookies de OAuth y la inyección de cabeceras de identidad. No
implementes rutas de la aplicación para esas rutas reservadas. Las rutas que no
importan ni llaman al ayudante permanecen disponibles para personas anónimas.

SIWC solo establece la identidad; no demuestra pertenencia al espacio de
trabajo. Usa los controles de políticas de acceso de la plataforma de hosting
de Sites para restricciones de todo el espacio de trabajo, o aplica en el
servidor verificaciones explícitas de membresía o lista de permitidos.

Usa SIWC para páginas de cuenta, paneles específicos de usuario, registros
guardados y acciones de escritura vinculadas a la persona usuaria actual de
ChatGPT. Mantén anónimo el contenido público.

## Comandos de diagnóstico

- `npm run install:ci`: realiza la instalación única y limitada del archivo de bloqueo
- `npm run dev`: inicia el servidor de desarrollo Vite/Vinext
- `npm run build`: compila y valida el artefacto desplegable de Sites
- `npm run start`: inicia la aplicación Vinext compilada
- `npm test`: compila, valida y verifica los metadatos renderizados de la vista previa de desarrollo
- `npm run validate:artifact`: vuelve a comprobar el manifiesto de un artefacto existente y la exportación ESM `default.fetch`
- `npm run db:generate`: genera migraciones de Drizzle después de cambiar el esquema

Usa los comandos de compilación y validación para diagnóstico específico después de un fallo remoto, no como parte del flujo normal de puntos de control.

Los tiempos de espera predeterminados se pueden reemplazar en una prueba controlada con `SITES_INSTALL_TIMEOUT`, `SITES_INSTALL_KILL_AFTER`, `SITES_BUILD_TIMEOUT` y `SITES_BUILD_KILL_AFTER`. Un tiempo de espera agota el comando; los ayudantes nunca reintentan una instalación o compilación sin cambios.

## Más información

- [Documentación de vinext](https://github.com/cloudflare/vinext)
- [Guía de Drizzle D1](https://orm.drizzle.team/docs/get-started/d1-new)
