# Resumen Técnico y Especificaciones de WorkClock Pro

Este documento detalla la arquitectura actual, funcionalidades, correcciones visuales y reglas de negocio de la aplicación WorkClock Pro, estructurado para servir como guía de transferencia a otros agentes o desarrolladores.

===============================================================================
1. ARQUITECTURA DEL SISTEMA (DESACOPLADA)
===============================================================================
Para mitigar las restricciones de cookies de terceros y problemas de inicio de sesión persistente en dispositivos móviles (especialmente bajo iOS/Safari), el sistema opera de manera desacoplada:

A. FRONTEND (Interfaz de Usuario)
   - Alojado de manera independiente en la plataforma Netlify.
   - Consiste en un único archivo estático ('index.html') escrito en HTML5, CSS3 y JavaScript nativo (Vanilla JS).
   - Su diseño sigue una filosofía "Mobile-First" optimizada estéticamente para asemejarse a una aplicación móvil nativa.
   - Toda la comunicación con el servidor se realiza mediante peticiones HTTP asíncronas utilizando la API Fetch.

B. BACKEND Y BASE DE DATOS
   - Desarrollado sobre la plataforma Google Apps Script ('Código.gs').
   - Vinculado de manera directa a una hoja de cálculo principal en Google Sheets que actúa como base de datos relacional implícita.
   - Expone un único punto de acceso público (Endpoint REST) mediante la función 'doPost(e)'.
   - Recibe parámetros estructurados en formato JSON, ejecuta la acción solicitada en la hoja de cálculo y retorna los resultados bajo el mismo formato estándar.

===============================================================================
2. FUNCIONALIDADES IMPLEMENTADAS Y REGLAS DE NEGOCIO
===============================================================================

A. CONTROL DE ASISTENCIA Y GEOLOCALIZACIÓN
   - Registro de Entrada: Añade una nueva fila al final de la hoja con la fecha, el día abreviado de la semana y la hora de inicio en formato de 24 horas. Cambia instantáneamente el estado visual a "Trabajando".
   - Registro de Salida y Validación Geográfica: Captura las coordenadas de longitud y latitud del dispositivo móvil. Para balancear precisión y experiencia de usuario en Safari, se configuró un tiempo máximo de espera (Timeout) de 4 segundos y una tolerancia de caché previa de 60 segundos.
   - Cálculo de Distancia (Haversine): Compara la ubicación actual contra las coordenadas fijas del lugar de trabajo. Si el radio es inferior o igual a 300 metros, se etiqueta automáticamente el campo como '✅ En sitio'. Si excede el límite, se marca como '🚩 Fuera'. Si el GPS es inaccesible o se agota el tiempo, guarda el registro de salida inmediatamente etiquetándolo como 'Sin GPS'.

B. DASHBOARD DE MÉTRICAS Y NÓMINA EN TIEMPO REAL
   - Panel de Horas: Calcula en tiempo real la sumatoria de las horas trabajadas en la semana en curso (de lunes a domingo) y en el mes actual.
   - Modo Alternable (Tiempo / COP): Al hacer clic sobre las tarjetas del panel, los textos cambian dinámicamente de tiempo acumulado a Salario Neto Estimado en Pesos Colombianos (COP).
   - Algoritmo de Nómina: Realiza una proyección matemática basada en:
     * Salario Mínimo Legal Vigente / Salario pactado de referencia.
     * Auxilio de transporte proporcional a las horas devengadas.
     * Deducciones legales obligatorias de salud (4%) y pensión (4%) calculadas proporcionalmente sobre la base salarial.

C. HISTORIAL Y GESTIÓN DE TURNOS DESDE LA APLICACIÓN
   - Vista de Turnos: Renderiza una tabla con un historial compacto conteniendo las últimas 5 jornadas registradas por el usuario.
   - Eliminación Directa: Permite la remoción segura de la última fila ingresada mediante un botón dedicado para evitar desajustes accidentales antiguos.
   - Inserción Manual: Formulario integrado en una ventana modal para declarar jornadas que el usuario olvidó registrar en tiempo real. Al enviarse, el backend ejecuta un reordenamiento automático (.sort()) en el Sheets basado en la primera columna para mantener la cronología intacta.
   - Edición Dinámica: Al presionar cualquier fila del historial, una ventana modal captura las horas actuales. Al modificarlas, actualiza de forma directa la celda específica de la hoja mediante la fórmula de Excel '=IF(Salida<Entrada, 1+Salida-Entrada, Salida-Entrada)' para controlar cambios de turno de medianoche y formatea el resultado en '[h]:mm:ss'.

D. AUTOMATIZACIÓN DE CIERRE DE MES
   - Función "Nuevo Mes": Botón administrativo dentro de la app que genera un respaldo exacto de la hoja actual creando una pestaña nueva nombrada bajo el mes y año procesado (ej. 'Mayo_2026').
   - Congelación de Datos: Durante el copiado, las fórmulas dinámicas se sobrescriben a valores planos de texto (ContentsOnly) para asegurar que el histórico no se altere con futuras modificaciones. Acto seguro, limpia por completo la hoja principal, inicializando los contadores a cero para comenzar el nuevo ciclo.

===============================================================================
3. CORRECCIONES VISUALES Y OPTIMIZACIONES DE COMPATIBILIDAD APLICADAS
===============================================================================
- Solución de Desborde en Inputs (iOS): Se aplicaron las reglas CSS 'box-sizing: border-box', '-webkit-appearance: none' y se forzó 'color-scheme: dark' en los elementos del formulario modal para evitar que los selectores nativos de hora en Safari deformaran los anchos de los contenedores.
- Depuración de Interfaz en Tablas: Se eliminaron redundancias visuales del historial (como íconos repetitivos de edición) para optimizar el espacio horizontal de visualización en pantallas de smartphones compactos.
- Unificación Estética: Se inyectaron vectores gráficos (SVG de un reloj) directamente como fondo en las propiedades de las hojas de estilo de los inputs de tiempo para suplir la carencia de iconos predeterminados en navegadores móviles.

===============================================================================
4. PRÓXIMOS PASOS RECOMENDADOS
===============================================================================
- Capa de Autenticación Local: Desarrollar una pantalla inicial de bloqueo que exija al usuario ingresar un código PIN numérico de acceso rápido antes de revelar el dashboard y habilitar las peticiones a la API del backend.
