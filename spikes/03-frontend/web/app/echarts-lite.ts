// PROTOTYPE — one tree-shaken ECharts entry (core + line + grid + tooltip + canvas)
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
export default echarts;
