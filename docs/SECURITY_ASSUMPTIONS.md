# Validación de contexto para el modelo de amenazas

Este documento registra el punto de control previo al modelo de amenazas definitivo.

## Contexto confirmado

- El reparto inicial tiene 7 participantes: 1 jefe de garzones, 1 barman, 4 garzones y 1 cajera.
- Cada trabajador tendrá una cuenta individual con correo o alias de usuario y contraseña.
- Los puntajes, comentarios, recompensas y planes de mejora serán datos laborales sensibles.
- El jefe de garzones administrará el trabajo diario, pero no representa a la administración completa del restaurante.
- Las evaluaciones comenzarán con uso real; el usuario no acepta un piloto puramente simulado.
- Las recompensas estarán limitadas al alcance del jefe y se relacionan con las propinas del equipo.
- Existe un acuerdo de 4,65 puntos de experiencia: jefe 1,00; garzones 1,00/0,65/0,50/0,25; barman 0,75 y cajera 0,50.
- La cuenta administradora no evalúa ni es evaluada.
- El jefe de garzones y la cajera evalúan a barman y garzones, pero no son evaluados; la cajera mantiene un factor fijo de 0,50 puntos.
- Los sujetos evaluados son el barman y los cuatro garzones; los evaluadores son esas cinco personas más el jefe de garzones y la cajera.
- El desempeño incluye conocimiento de tragos, vinos y comidas; explicación al cliente; exactitud de comandas; servicio y trabajo en equipo.

## Suposiciones residuales

- Se asume un solo local durante la primera versión.
- La web seguirá alojada en Sites y usará identidad autenticada y almacenamiento D1 administrado.
- La aplicación será accesible por Internet, aunque limitada a personas autorizadas.

## Preguntas que cambian el diseño y la prioridad de riesgos

1. Confirmar si la primera versión corresponde a un solo local.
2. Definir si las cuentas serán administradas localmente o mediante un proveedor de identidad.
3. Registrar fecha de vigencia, frecuencia de revisión y evidencia del acuerdo de 4,65 puntos de experiencia antes de activar cálculos monetarios.

## Riesgos preliminares ya confirmados en el repositorio

- Elevación de privilegios por selector local de rol en `app/page.tsx`.
- Decisiones sin integridad porque no existe persistencia ni auditoría en `db/schema.ts`.
- Promesas de anonimato y detección de fraude sin implementación.
- Ausencia de controles contra duplicados, autoevaluación, colusión y represalia.
- Falta de pruebas de autorización, cálculo, privacidad y separación de funciones.

El informe `web-evaluacion-threat-model.md` refleja las respuestas entregadas y marca las suposiciones residuales.
