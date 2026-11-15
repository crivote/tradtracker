# Cambios

Lo que cambia **para quien usa tuneshed**, de lo más reciente a lo más antiguo. El historial anterior a este
fichero vive en los commits y en los issues del repositorio; aquí se anota lo que se nota, no cada refactor.
Formato: [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Fechas locales (Europe/Madrid).

## [No publicado] — corte #65

### Añadido
- **Reparto por nivel** en la home: donut con el total en el centro y leyenda con cifra y porcentaje, donde
  cada fila abre el listado de ese nivel. Sustituye a la línea de recuentos que había bajo el título.
- **Tendencia del vencimiento**: gráfica de vencidas por día junto al histograma, desde la primera transición
  de peldaño registrada. Dice si se gana o se pierde terreno.
- **Racha completa**: además de la racha actual, la mejor conseguida y la anterior.
- **«+ Add a tune» en el menú principal**, presente en todas las pantallas: un solo cajón del alta, compartido,
  que no mueve la pantalla y recarga la vista al terminar.
- Tramos **61–90** y **90+** en el histograma de antigüedad: una sola barra de «60+» no distinguía un trimestre
  sin tocar de dos años.

### Corregido
- **«Alive · 14 days» ya no marca 0 con repertorio activo.** La consulta de marcas se traía las 1.000 más
  antiguas por el tope del servidor y dejaba el presente fuera; ahora pide las más recientes y avisa si la
  carga se corta.
- **«Vencidas» dice una sola cosa**: la tarjeta da el recuento con su porcentaje y su denominador escritos, y
  el pie de la gráfica compara recuentos del mismo censo —antes eran 68,9 % y 79,1 % con dos denominadores
  bajo la misma palabra—.
- **«No record» ya no se repite** en el histograma: vive en su tarjeta y la gráfica solo mide lo que tiene
  registro, diciendo cuántas quedan fuera.
- La cabecera de la home ya no duplica la búsqueda que está en el menú.

### Verificado
- `tsc` limpio, build correcto, suite completa en verde.
- En navegador con cuenta efímera y las marcas del repertorio real copiadas: el donut suma el repertorio
  entero, sin desbordes a 1280 y 420 px, y el cajón del alta abre desde cualquier ruta con el papel y la
  tipografía de la app.
