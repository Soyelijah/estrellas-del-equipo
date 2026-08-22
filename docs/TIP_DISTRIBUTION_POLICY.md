# Política propuesta de consecuencias sobre propinas

Estado: la tabla de factores vigente está confirmada. Faltan su fecha de vigencia, frecuencia de revisión y mecanismo formal de aprobación de cambios.

## Decisión incorporada

Los siete participantes del reparto acordaron factores distintos según experiencia y desempeño. El sistema conservará ese acuerdo como una versión vigente y contemplará consecuencias positivas y negativas. No será un mecanismo de “solo dar”: el desempeño insuficiente y repetido podrá disminuir el factor futuro dentro de la regla acordada antes del período.

Datos pendientes para digitalizar el acuerdo real:

- Alias o nombre real que reemplazará cada etiqueta de cargo.
- Fecha desde la que rige esa tabla.
- Frecuencia acordada para revisar porcentajes.
- Quiénes deben aprobar un cambio y cómo puede revisarlo la persona afectada.

## Diferencia esencial

- **Propina directa de un cliente a un trabajador:** el sistema no la toca.
- **Fondo común distribuido por pacto del equipo:** el sistema puede calcular un factor variable si el pacto lo autoriza expresamente.
- **Descuento improvisado por el jefe:** el sistema lo bloquea.
- **Factor negativo ya acordado, limitado y revisado:** el sistema puede autorizarlo.

La responsabilidad del jefe se representa como capacidad de observar, proponer, revisar y ejecutar la fórmula acordada. No permite crear una regla retroactiva o exceder sus límites.

## Tabla vigente confirmada

Los porcentajes informados representan experiencia convertida a factor: `100% = 1,00 punto`, `75% = 0,75`, `65% = 0,65`, `50% = 0,50` y `25% = 0,25`. No son el porcentaje final que cada persona recibe del fondo. Los siete factores suman 4,65 puntos:

| Participante | Experiencia | Factor | Participación normalizada aproximada | Evalúa | Es evaluado |
|---|---:|---:|---:|---:|---:|
| Garzón jefe | 100% | 1,00 | 21,505% | No | No |
| Garzón 1 | 100% | 1,00 | 21,505% | Sí | Sí |
| Garzón 2 | 65% | 0,65 | 13,978% | Sí | Sí |
| Garzón 3 | 50% | 0,50 | 10,753% | Sí | Sí |
| Garzón 4 | 25% | 0,25 | 5,376% | Sí | Sí |
| Barman | 75% | 0,75 | 16,129% | Sí | Sí |
| Cajera | 50% | 0,50 | 10,753% | Sí | No |

La participación de cada persona se calcula para cada fondo como `factor individual / suma de factores`. El algoritmo guarda los factores en centésimas enteras —por ejemplo, `0,75` se almacena como `75`— y usa pesos chilenos enteros con asignación por restos mayores para que no falte ni sobre dinero por redondeo.

### Ejemplo verificado

Para tres trabajadores con factores `1,00 + 0,50 + 0,25 = 1,75` y un fondo de `$195.000`:

1. Valor de un punto: `$195.000 / 1,75 = $111.428,571…`.
2. Entitlements antes de redondear: `$111.428,571…`, `$55.714,286…` y `$27.857,143…`.
3. Reparto entero por restos mayores: **$111.429, $55.714 y $27.857**.
4. Comprobación: `$111.429 + $55.714 + $27.857 = $195.000`.

Si el segundo trabajador fuera realmente de `0,75`, la suma sería `2,00` y el reparto cambiaría a `$97.500, $73.125 y $24.375`. Por eso el sistema muestra siempre porcentaje de experiencia, factor, suma de factores y reparto resultante antes de confirmar.

Los factores del jefe y de la cajera se consideran fijos en la primera versión. Los factores de barman y garzones podrán revisarse mediante el resultado integral, pero el nuevo factor comienza en un período futuro y no modifica fondos ya repartidos.

El fondo debe cerrar matemáticamente. Antes de activarlo se simulan al menos tres montos, incluyendo uno que produzca fracciones, para comprobar que la suma distribuida coincide exactamente con el fondo.

## Puntaje integral propuesto

No depende únicamente de opiniones entre compañeros:

| Componente | Peso inicial | Evidencia |
|---|---:|---|
| Trabajo en equipo y apoyo | 25% | Pares elegibles |
| Servicio y explicación al cliente | 20% | Pauta conductual y casos observados |
| Conocimiento de carta | 20% | Microevaluaciones de comida, vinos y tragos |
| Exactitud operacional | 20% | Errores de comanda confirmados y seguimiento |
| Responsabilidad | 10% | Preparación, puntualidad y tareas verificables |
| Mejora | 5% | Progreso respecto del período anterior |

Los módulos se adaptan al cargo. El barman profundiza recetas, técnica y barra; los garzones profundizan carta y recomendación. El jefe administra y la cajera actúa como observadora evaluadora sin recibir una calificación propia.

## Reglas que el software impondrá

1. Todos los participantes afectados aceptaron o ratificaron la versión del pacto.
2. La regla estaba activa antes de comenzar el período.
3. La reducción no supera el máximo aceptado.
4. Ninguna propina directa del cliente resulta afectada.
5. Se cumple la muestra mínima y no hay alertas de integridad pendientes.
6. El jefe revisó la evidencia y registró un motivo concreto.
7. El trabajador vio el resultado y pudo responder.
8. Mientras exista una revisión abierta, el ajuste negativo queda suspendido.
9. Todo cálculo, aprobación y cambio queda auditado.
10. Un único error, examen o comentario nunca produce una reducción.

## Progresividad

- Primera señal: feedback privado y práctica dirigida.
- Repetición verificada: objetivo de mejora con fecha.
- Incumplimiento persistente durante el período, con evidencia suficiente: factor variable negativo dentro del pacto.
- Falta disciplinaria formal: sale de este motor y sigue el procedimiento laboral aplicable.

## Base normativa verificada

La Dirección del Trabajo señala que las propinas pertenecen a los trabajadores, que el empleador no puede descontarlas ni decidir unilateralmente su distribución, y que los pactos de distribución pertenecen a la autonomía de los trabajadores. También ha indicado que no procede privar de propinas a quien no consintió el pacto correspondiente.

- [DT: intervención y descuentos sobre propinas](https://dt.gob.cl/portal/1628/w3-article-109453.html)
- [DT ORD. 5212: titularidad y distribución](https://www.dt.gob.cl/legislacion/1624/w3-article-110453.html)
- [DT: pacto de distribución y consentimiento](https://www.dt.gob.cl/legislacion/1624/w3-propertyvalue-192996.html)

Antes de activar efectos monetarios, el pacto concreto debe revisarse con quien corresponda en el restaurante y, si hay duda, con asesoría laboral o la Dirección del Trabajo.
