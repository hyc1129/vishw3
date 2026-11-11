// ==========================================
// 1. 初始化與全域變數設定
// ==========================================
const mapSvg = d3.select("#map-svg");
const treeSvg = d3.select("#treemap-svg");
const barSvg = d3.select("#barchart-svg");
const tooltip = d3.select("#tooltip");

// 響應式 viewBox，確保在 A3 模板 iframe 中自適應縮放
const mapW = 600, mapH = 800;
mapSvg.attr("viewBox", `0 0 ${mapW} ${mapH}`);

const treeW = 600, treeH = 350;
treeSvg.attr("viewBox", `0 0 ${treeW} ${treeH}`);

const barW = 600, barH = 350;
barSvg.attr("viewBox", `0 0 ${barW} ${barH}`);

// 全域狀態控制
let currentSelectedOrigin = null; // 紀錄目前點擊過濾的出發機場
let globalFlowData = [];          // 儲存原始資料供過濾使用

// 載入資料
Promise.all([
    d3.json("counties-10t.json"),
    d3.json("d3_flow_map.json"),
    d3.json("d3_treemap.json")
]).then(([topoData, flowData, treeData]) => {
    
    globalFlowData = flowData;

    // 定義色彩比例尺 (依據出發機場，使用 Tableau10 色系)
    const origins = treeData.children.map(d => d.name);
    const colorScale = d3.scaleOrdinal(d3.schemeTableau10).domain(origins);

    // 定義流量 -> 視覺寬度的比例尺
    const maxPax = d3.max(flowData, d => d.passengers);
    const strokeScale = d3.scaleSqrt().domain([0, maxPax]).range([1.5, 12]);

    // ==========================================
    // View 1: 繪製地理流向圖 (Map)
    // ==========================================
    // 台灣中心投影
    const projection = d3.geoMercator()
        .center([121, 24])
        .scale(6500)
        .translate([mapW / 2, mapH / 2]);
    const pathGenerator = d3.geoPath().projection(projection);

    const mapLayer = mapSvg.append("g");
    
    // 1.1 繪製縣市底圖
    const counties = topojson.feature(topoData, topoData.objects.counties).features;
    mapLayer.append("g")
        .selectAll(".county")
        .data(counties)
        .join("path")
        .attr("class", "county")
        .attr("d", pathGenerator)
        .on("click", resetFilter); // 點擊空地取消過濾

    // 1.2 繪製航線 (弧線)
    const routeG = mapLayer.append("g");
    function renderMapRoutes(data) {
        routeG.selectAll(".route-arc")
            .data(data, d => d.route_name)
            .join(
                enter => enter.append("path")
                    .attr("class", "route-arc default-opacity")
                    .attr("id", d => `arc-${d.route_name}`)
                    .attr("d", d => {
                        const p1 = projection(d.origin_coord);
                        const p2 = projection(d.dest_coord);
                        const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
                        // 計算弧線半徑
                        const dr = Math.sqrt(dx * dx + dy * dy) * 1.2; 
                        return `M${p1[0]},${p1[1]}A${dr},${dr} 0 0,1 ${p2[0]},${p2[1]}`;
                    })
                    .attr("stroke-width", d => strokeScale(d.passengers))
                    .attr("stroke", d => colorScale(d.origin_name))
                    .attr("tabindex", "0")
                    .on("mouseover", (event, d) => handleMouseOver(event, d))
                    .on("mouseout", handleMouseOut)
                    .on("keydown", (event, d) => handleKeydown(event, d)),
                update => update,
                exit => exit.transition().duration(400).style("opacity", 0).remove()
            );
    }

    // 1.3 繪製機場節點 (點擊用作過濾器)
    // 整理出所有不重複的機場座標
    const airportNodes = Array.from(new Set(flowData.map(d => d.origin_name)))
        .map(name => {
            const row = flowData.find(d => d.origin_name === name);
            return { name: name, coord: row.origin_coord };
        });

    mapLayer.append("g")
        .selectAll(".airport-node")
        .data(airportNodes)
        .join("circle")
        .attr("class", "airport-node default-opacity")
        .attr("cx", d => projection(d.coord)[0])
        .attr("cy", d => projection(d.coord)[1])
        .attr("r", 6)
        .attr("fill", d => colorScale(d.name))
        .attr("tabindex", "0")
        // 點擊事件：啟動跨視圖過濾
        .on("click", (event, d) => filterByOrigin(d.name))
        .on("keydown", (event, d) => { if(event.key === "Enter") filterByOrigin(d.name); })
        .append("title")
        .text(d => `過濾：${d.name} 出發航線`);

    // ==========================================
    // View 2: 繪製樹狀圖 (Treemap)
    // ==========================================
    const treeG = treeSvg.append("g").attr("transform", "translate(0, 30)"); // 留標題空間
    
    function renderTreemap(rootData) {
        const root = d3.hierarchy(rootData)
            .sum(d => d.value || 0)
            .sort((a, b) => b.value - a.value);

        d3.treemap()
            .size([treeW, treeH - 40])
            .paddingInner(2)
            .paddingTop(22)(root);

        // 綁定資料，依據 route_name 維持物件恆常性 (Object Constancy)
        const cells = treeG.selectAll(".tree-cell")
            .data(root.leaves(), d => d.data.route_name);

        const enterCells = cells.enter().append("g")
            .attr("class", "tree-cell")
            .attr("transform", d => `translate(${d.x0},${d.y0})`);

        enterCells.append("rect")
            .attr("class", "treemap-node default-opacity")
            .attr("id", d => `rect-${d.data.route_name}`)
            .attr("fill", d => colorScale(d.parent.data.name))
            .attr("width", d => Math.max(0, d.x1 - d.x0))
            .attr("height", d => Math.max(0, d.y1 - d.y0))
            .attr("tabindex", "0")
            .on("mouseover", (event, d) => handleMouseOver(event, d.data))
            .on("mouseout", handleMouseOut)
            .on("keydown", (event, d) => handleKeydown(event, d.data));

        enterCells.append("text")
            .attr("class", "treemap-label")
            .attr("x", 4).attr("y", 14)
            .text(d => d.data.name);

        enterCells.append("text")
            .attr("class", "treemap-sublabel")
            .attr("x", 4).attr("y", 26)
            .text(d => d.data.value.toLocaleString() + "人");

        // 更新與轉場動畫 (Animation Transition)
        const updateCells = enterCells.merge(cells);
        updateCells.transition().duration(600)
            .attr("transform", d => `translate(${d.x0},${d.y0})`);
            
        updateCells.select("rect").transition().duration(600)
            .attr("width", d => Math.max(0, d.x1 - d.x0))
            .attr("height", d => Math.max(0, d.y1 - d.y0));
            
        // 隱藏太小無法顯示文字的標籤
        updateCells.selectAll("text").transition().duration(600)
            .style("opacity", d => (d.x1 - d.x0) > 45 && (d.y1 - d.y0) > 30 ? 1 : 0);

        cells.exit().transition().duration(400).style("opacity", 0).remove();
    }

    // ==========================================
    // View 3: 繪製載客率長條圖 (Bar Chart)
    // ==========================================
    const margin = { top: 30, right: 20, bottom: 20, left: 70 };
    const chartW = barW - margin.left - margin.right;
    const chartH = barH - margin.top - margin.bottom;

    const barG = barSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    
    // 建立 X 軸與 Y 軸比例尺
    const xScale = d3.scaleLinear().domain([0, 100]).range([0, chartW]);
    const yScale = d3.scaleBand().range([0, chartH]).padding(0.2);

    // 繪製 X 軸與格線
    const xAxis = d3.axisTop(xScale).ticks(5).tickFormat(d => d + "%");
    barSvg.append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`)
        .call(xAxis)
        .call(g => g.select(".domain").remove()) // 移除基準線
        .call(g => g.selectAll(".tick line").attr("y2", chartH).attr("stroke-opacity", 0.1));

    const yAxisG = barSvg.append("g").attr("transform", `translate(${margin.left}, ${margin.top})`);

    function renderBarchart(data) {
        // 依據載客率排序資料
        const sortedData = [...data].sort((a, b) => b.load_factor - a.load_factor);
        
        yScale.domain(sortedData.map(d => d.route_name));
        
        // 更新 Y 軸文字
        yAxisG.transition().duration(600)
            .call(d3.axisLeft(yScale).tickSizeOuter(0))
            .selectAll("text").attr("class", "axis-text");

        const bars = barG.selectAll(".bar")
            .data(sortedData, d => d.route_name);

        bars.join(
            enter => enter.append("rect")
                .attr("class", "bar default-opacity")
                .attr("id", d => `bar-${d.route_name}`)
                .attr("x", 0)
                .attr("y", d => yScale(d.route_name))
                .attr("height", yScale.bandwidth())
                .attr("width", 0) // 動畫起點
                .attr("fill", d => colorScale(d.origin_name))
                .attr("tabindex", "0")
                .on("mouseover", (event, d) => handleMouseOver(event, d))
                .on("mouseout", handleMouseOut)
                .on("keydown", (event, d) => handleKeydown(event, d))
                .call(enter => enter.transition().duration(600)
                    .attr("width", d => xScale(d.load_factor))
                ),
            update => update.call(update => update.transition().duration(600)
                .attr("y", d => yScale(d.route_name))
                .attr("height", yScale.bandwidth())
                .attr("width", d => xScale(d.load_factor))
            ),
            exit => exit.transition().duration(400).attr("width", 0).remove()
        );
    }

    // 初始化三視圖
    renderMapRoutes(flowData);
    renderTreemap(treeData);
    renderBarchart(flowData);

    // ==========================================
    // 核心連動：中央事件調度器 (Coordinated Dispatcher)
    // ==========================================
    
    // 統一處理 Hover 狀態 (Selection + Highlighting)
    function handleMouseOver(event, dataObj) {
        const targetRoute = dataObj.route_name;

        // 1. 同步變更三個視圖的類別 (CSS class切換透明度)
        mapSvg.selectAll(".route-arc")
            .classed("muted", d => d.route_name !== targetRoute)
            .classed("highlight", d => d.route_name === targetRoute);
            
        treeSvg.selectAll(".treemap-node")
            .classed("muted", d => d.data.route_name !== targetRoute)
            .classed("highlight", d => d.data.route_name === targetRoute);
            
        barSvg.selectAll(".bar")
            .classed("muted", d => d.route_name !== targetRoute)
            .classed("highlight", d => d.route_name === targetRoute);

        // 2. 顯示共用 Tooltip (Details-on-demand)
        tooltip.style("opacity", 1)
            .html(`
                <strong>航線：</strong> ${targetRoute}<br/>
                <strong>載客人數：</strong> ${parseInt(dataObj.passengers || dataObj.value).toLocaleString()} 人<br/>
                <strong>載客率：</strong> ${dataObj.load_factor}%<br/>
                <strong>飛行架次：</strong> ${dataObj.flights} 次
            `)
            .style("left", (event.pageX + 15) + "px")
            .style("top", (event.pageY - 28) + "px");
    }

    // 恢復預設狀態
    function handleMouseOut() {
        mapSvg.selectAll(".route-arc").classed("muted highlight", false);
        treeSvg.selectAll(".treemap-node").classed("muted highlight", false);
        barSvg.selectAll(".bar").classed("muted highlight", false);
        tooltip.style("opacity", 0);
    }

    // 處理鍵盤可及性
    function handleKeydown(event, dataObj) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleMouseOver(event, dataObj);
        } else if (event.key === "Escape") {
            handleMouseOut();
        }
    }

    // ==========================================
    // 核心過濾：點擊地圖機場下鑽 (Dynamic Filtering)
    // ==========================================
    function filterByOrigin(originName) {
        if (currentSelectedOrigin === originName) return; // 重複點擊忽略
        currentSelectedOrigin = originName;

        // 1. 過濾地圖航線 (在地圖上這只是變色不移除，保留地理脈絡)
        mapSvg.selectAll(".route-arc")
            .transition().duration(400)
            .style("opacity", d => d.origin_name === originName ? 1 : 0.05);

        // 2. 過濾長條圖資料
        const filteredFlow = globalFlowData.filter(d => d.origin_name === originName);
        renderBarchart(filteredFlow);

        // 3. 過濾並重建樹狀圖根節點
        const filteredTreeData = {
            name: originName,
            children: treeData.children.filter(d => d.name === originName)
        };
        renderTreemap(filteredTreeData);
    }

    // 點擊空地重置全域過濾
    function resetFilter() {
        if (!currentSelectedOrigin) return;
        currentSelectedOrigin = null;

        // 重置地圖
        mapSvg.selectAll(".route-arc")
            .transition().duration(400)
            .style("opacity", null); // 回歸 CSS 控制

        // 重置長條圖與樹狀圖
        renderBarchart(globalFlowData);
        renderTreemap(treeData);
    }
});