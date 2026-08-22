# Auditoría del estado actual

Fecha de verificación: 2026-08-15
Versión revisada: Sites v2, commit `612b5bb453b49293839c7dc2587eaa60f32225e5`

## Veredicto

El proyecto tiene una base visual, reglas de justicia, esquema y endpoint protegido, pero todavía no está activado para recopilar evaluaciones reales. La interfaz ya no presenta datos ficticios: muestra únicamente la configuración confirmada y estados vacíos hasta completar cuentas, D1, turnos y períodos.

## Evidencia del estado

| Área | Estado confirmado | Evidencia | Riesgo |
|---|---|---|---|
| Datos | Nombres, resultados, alertas y recompensas están codificados en el cliente | `app/page.tsx` | La pantalla puede confundirse con información real |
| Persistencia | El esquema está vacío y D1 está deshabilitado | `db/schema.ts`, `.openai/hosting.json` | Las valoraciones desaparecen y no existe historial |
| Identidad | Existe un helper de identidad, pero la página no lo usa | `app/chatgpt-auth.ts`, `app/page.tsx` | No se conoce realmente al usuario |
| Autorización | No se habilita ninguna vista personal o administrativa sin sesión | `app/page.tsx` | Falta conectar la identidad real a la interfaz |
| Evaluación | El formulario visible está deshabilitado hasta que haya turno y cuenta | `app/page.tsx` | El endpoint existe, pero la UI aún no lo consume |
| Reglas de justicia | El dominio y la API validan elegibilidad, cobertura y respuestas | `domain/`, `server/` | Falta operar estas reglas con D1 migrada |
| Recompensas | Beneficios y progreso son datos de muestra | `app/page.tsx` | No hay aprobación, presupuesto ni trazabilidad |
| Disciplina | Solo aparece un castigo por omisión en el contenido | `app/page.tsx` | No existe procedimiento, descargos ni separación de funciones |
| Pruebas | Una prueba confirma render y metadato de desarrollo | `tests/rendered-html.test.mjs` | No cubre conducta, seguridad, justicia ni accesibilidad |
| Compilación | Build de producción y prueba existente aprobados | `npm test`, 2026-08-15 | Prueba integridad técnica mínima, no aptitud operativa |

## Fortalezas que conviene preservar

- Dirección visual cálida y apropiada para un equipo humano, sin estética punitiva.
- Separación conceptual entre trabajador y administración.
- Criterios comprensibles: trabajo en equipo, actitud, apoyo y servicio.
- Énfasis visible en reglas, anonimato, atípicos y transparencia.
- Diseño responsive y respeto por `prefers-reduced-motion`.
- Interacción de estrellas con `radiogroup` y etiquetas accesibles.
- La recompensa no se reduce únicamente a dinero.

## Problemas UX priorizados

### Críticos

1. **La identidad aún no está conectada a la página.** No se concede un rol local, pero falta cargar el usuario autorizado desde el servidor.
2. **La interfaz todavía no consume el endpoint seguro.** El formulario permanece bloqueado hasta completar cuentas, turnos y D1.
3. **Resuelto: datos ficticios.** Se eliminaron fechas, puntajes, alertas, recompensas e identidades simuladas; ahora se usan estados vacíos auténticos.

### Altos

1. No existen estados de carga, error de red, reintento, sin permiso ni datos vacíos.
2. Después de “enviar”, la evaluación sigue editable pese a que el texto afirma lo contrario.
3. Botones como exportar informe y nueva regla no tienen comportamiento ni estado deshabilitado explicativo.
4. No hay confirmación ni resumen previo para una acción laboral sensible.
5. El cierre automático con promedio puede fabricar una opinión que la persona nunca emitió; debe registrarse como ausencia de dato, no como valoración.

### Medios

1. Algunos controles táctiles son menores al objetivo recomendado de 44 px.
2. El estado de foco no está definido consistentemente para botones y navegación.
3. Los símbolos usados como iconos no tienen un lenguaje visual uniforme.
4. La tabla administrativa necesita una alternativa accesible y responsiva que conserve encabezados y contexto.
5. Falta explicar muestra, confianza y período junto a cada puntuación.

## Riesgos de justicia más importantes

1. **Popularidad:** una persona sociable puede recibir mejores notas que otra igualmente competente.
2. **Represalia:** una valoración negativa puede provocar otra negativa de vuelta.
3. **Colusión:** dos o más compañeros pueden intercambiar puntuaciones extremas.
4. **Oportunidad desigual:** cocina, barra y salón no tienen los mismos observadores ni métricas.
5. **Muestra pequeña:** pocos votos pueden producir un ranking inestable.
6. **Sesgo del líder:** un ajuste manual sin motivo puede dominar el resultado.
7. **Automatización indebida:** un puntaje agregado puede presentarse como certeza y gatillar una sanción.
8. **Datos sensibles:** comentarios libres pueden revelar salud, vida personal, acusaciones o identidad del evaluador.

## Condición para usar con trabajadores reales

No ingresar datos reales ni tomar decisiones hasta completar como mínimo identidad, autorización en servidor, persistencia, reglas versionadas, muestra mínima, explicación, revisión, auditoría y pruebas específicas. El primer despliegue real debe ser un piloto de sombra sin premios ni sanciones.
