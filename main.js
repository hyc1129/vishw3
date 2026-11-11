// ==========================================
// 1. 初始化與全域變數設定
// ==========================================
const mapSvg = d3.select("#map-svg");
const treeSvg = d3.select("#treemap-svg");
const barSvg = d3.select("#barchart-svg");
const tooltip = d3.select("#tooltip");

const mapW = 600, mapH = 800;
mapSvg.attr("viewBox", `0 0 ${mapW} ${mapH}`);
const treeW = 600, treeH = 350;
treeSvg.attr("viewBox", `0 0 ${treeW} ${treeH}`);
const barW = 600, barH = 350;
barSvg.attr("viewBox", `0 0 ${barW} ${barH}`);

let currentSelectedAirport = null; 
let globalFlowData = [];          
let allAirports = []; 

Promise.all([
    d3.json("counties-10t.json"), 
    d3.json("d3_flow_map.json")   
]).then(([topoData, flowData]) => {
    
    globalFlowData = flowData;

    const airportSet = new Map();
    flowData.forEach(d => {
        if (!airportSet.has(d.origin_name)) airportSet.set(d.origin_name, d.origin_coord);
        if (!airportSet.has(d.dest_name)) airportSet.set(d.dest_name, d.dest_coord);
    });
    
    allAirports = Array.from(airportSet.keys());
    const airportNodes = allAirports.map(name => ({
        name: name,
        coord: airportSet.get(name)
    }));

    const colorScale = d3.scaleOrdinal(d3.schemeTableau10).domain(allAirports);
    const strokeScale = d3.scaleSqrt().domain([0, d3.max(flowData, d => d.passengers)]).range([1.5, 12]);

    // ==========================================
    // View 1: 繪製地理流向圖 (Map)
    // ==========================================
    const projection = d3.geoMercator()
        .center([120, 24]) 
        .scale(6500)
        .translate([mapW / 2, mapH / 2]);
    const pathGenerator = d3.geoPath().projection(projection);

    const mapLayer = mapSvg.append("g");
    
    const counties = topojson.feature(topoData, topoData.objects.counties).features;
    mapLayer.append("g")
        .selectAll(".county")
        .data(counties)
        .join("path")
        .attr("class", "county")
        .attr("d", pathGenerator)
        // 【隱含操作】點擊地圖背景重置
        .on("click", resetFilter)
        .append("title").text("點擊空白處重置全域"); 

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
                        const dr = Math.sqrt(dx * dx + dy * dy) * 1.2; 
                        return `M${p1[0]},${p1[1]}A${dr},${dr} 0 0,1 ${p2[0]},${p2[1]}`;
                    })
                    .attr("stroke-width", d => strokeScale(d.passengers))
                    .attr("stroke", d => colorScale(d.origin_name))
                    .on("mouseover", (event, d) => handleMouseOver(event, d, "route"))
                    .on("mouseout", handleMouseOut),
                update => update,
                exit => exit.transition().duration(400).style("opacity", 0).remove()
            );
    }

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
        .on("mouseover", function(event, d) {
            d3.select(this).transition().duration(200).attr("r", 10);
            
            // 若該機場已選取，提示文字改為「取消選取」
            const isSelected = currentSelectedAirport === d.name;
            tooltip.style("opacity", 1)
                .html(`<strong>機場：</strong> ${d.name}<br/><span style="font-size:11px; color:#cbd5e1;">點擊${isSelected ? '取消選取' : '過濾此機場航線'}</span>`)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", function() {
            d3.select(this).transition().duration(200).attr("r", 6);
            tooltip.style("opacity", 0);
        })
        .on("click", (event, d) => filterByAirport(d.name)) 
        .on("keydown", (event, d) => { if(event.key === "Enter") filterByAirport(d.name); });

    // ==========================================
    // View 2: 動態階層樹狀圖 (Treemap)
    // ==========================================
    const treeG = treeSvg.append("g").attr("transform", "translate(0, 30)");
    
    function renderTreemap(airportFilter) {
        let isGlobal = !airportFilter;
        let rootData;

        if (isGlobal) {
            const globalChildren = allAirports.map(airport => {
                const connected = globalFlowData.filter(d => d.origin_name === airport || d.dest_name === airport);
                return {
                    name: airport,
                    value: d3.sum(connected, d => d.passengers),
                    isGlobalNode: true
                };
            }).filter(d => d.value > 0);
            rootData = { name: "全台機場", children: globalChildren };
        } else {
            const connected = globalFlowData.filter(d => d.origin_name === airportFilter || d.dest_name === airportFilter);
            const localChildren = connected.map(d => {
                const targetName = d.origin_name === airportFilter ? d.dest_name : d.origin_name;
                return {
                    name: targetName,
                    value: d.passengers,
                    route_name: d.route_name,
                    flights: d.flights,
                    load_factor: d.load_factor,
                    isGlobalNode: false
                };
            });
            rootData = { name: airportFilter, children: localChildren };
        }

        const nodeToDraw = d3.hierarchy(rootData)
            .sum(d => Math.pow(d.value || 0, 0.3)) 
            .sort((a, b) => b.data.value - a.data.value); 

        d3.treemap().size([treeW, treeH - 40]).paddingInner(2).paddingTop(0)(nodeToDraw);

        const cells = treeG.selectAll(".tree-cell")
            .data(nodeToDraw.leaves(), d => d.data.name);

        const enterCells = cells.enter().append("g")
            .attr("class", "tree-cell")
            .attr("transform", d => `translate(${d.x0},${d.y0})`);

        enterCells.append("rect")
            .attr("class", "treemap-node default-opacity")
            .attr("fill", d => isGlobal ? colorScale(d.data.name) : colorScale(d.parent.data.name))
            .attr("width", d => Math.max(0, d.x1 - d.x0))
            .attr("height", d => Math.max(0, d.y1 - d.y0))
            .attr("tabindex", "0")
            .on("mouseover", (event, d) => handleMouseOver(event, d.data, isGlobal ? "global_airport" : "route"))
            .on("mouseout", handleMouseOut)
            // 點擊事件：全域時進入該機場，已選取時則維持現狀 (或由其他機制重置)
            .on("click", (event, d) => { if(isGlobal) filterByAirport(d.data.name); });

        enterCells.append("text").attr("class", "treemap-label")
            .attr("x", 4).attr("y", 14).text(d => d.data.name);
        enterCells.append("text").attr("class", "treemap-sublabel")
            .attr("x", 4).attr("y", 26).text(d => d.data.value.toLocaleString() + "人");

        const updateCells = enterCells.merge(cells);
        updateCells.transition().duration(600).attr("transform", d => `translate(${d.x0},${d.y0})`);
        updateCells.select("rect").transition().duration(600)
            .attr("width", d => Math.max(0, d.x1 - d.x0))
            .attr("height", d => Math.max(0, d.y1 - d.y0));
            
        updateCells.selectAll("text").transition().duration(600)
            .style("opacity", d => (d.x1 - d.x0) > 35 && (d.y1 - d.y0) > 15 ? 1 : 0);

        cells.exit().transition().duration(400).style("opacity", 0).remove();
    }

    // ==========================================
    // View 3: 長條圖 (Bar Chart)
    // ==========================================
    const margin = { top: 30, right: 20, bottom: 20, left: 70 };
    const barG = barSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const xScale = d3.scaleLinear().domain([0, 100]).range([0, barW - margin.left - margin.right]);
    const yScale = d3.scaleBand().range([0, barH - margin.top - margin.bottom]).padding(0.2);
    const yAxisG = barSvg.append("g").attr("transform", `translate(${margin.left}, ${margin.top})`);

    function renderBarchart(data) {
        const sortedData = [...data].sort((a, b) => b.load_factor - a.load_factor);
        yScale.domain(sortedData.map(d => d.route_name));
        yAxisG.transition().duration(600).call(d3.axisLeft(yScale).tickSizeOuter(0));

        const bars = barG.selectAll(".bar").data(sortedData, d => d.route_name);
        bars.join(
            enter => enter.append("rect")
                .attr("class", "bar default-opacity")
                .attr("x", 0).attr("y", d => yScale(d.route_name))
                .attr("height", yScale.bandwidth())
                .attr("width", 0)
                .attr("fill", d => colorScale(d.origin_name))
                .on("mouseover", (event, d) => handleMouseOver(event, d, "route"))
                .on("mouseout", handleMouseOut)
                .call(enter => enter.transition().duration(600).attr("width", d => xScale(d.load_factor))),
            update => update.call(update => update.transition().duration(600)
                .attr("y", d => yScale(d.route_name))
                .attr("height", yScale.bandwidth())
                .attr("width", d => xScale(d.load_factor))),
            exit => exit.transition().duration(400).attr("width", 0).remove()
        );
    }

    // 初始渲染
    renderMapRoutes(globalFlowData);
    renderTreemap(null);
    renderBarchart(globalFlowData);

    // ==========================================
    // 核心連動：智慧判斷與事件調度
    // ==========================================
    function handleMouseOver(event, dataObj, type) {
        let targetRoutes = [];
        
        if (type === "global_airport") {
            targetRoutes = globalFlowData
                .filter(d => d.origin_name === dataObj.name || d.dest_name === dataObj.name)
                .map(d => d.route_name);
        } else {
            targetRoutes = [dataObj.route_name];
        }

        mapSvg.selectAll(".route-arc")
            .classed("muted", d => !targetRoutes.includes(d.route_name))
            .classed("highlight", d => targetRoutes.includes(d.route_name));
            
        treeSvg.selectAll(".treemap-node")
            .classed("muted", d => type === "global_airport" ? d.data.name !== dataObj.name : d.data.route_name !== dataObj.route_name)
            .classed("highlight", d => type === "global_airport" ? d.data.name === dataObj.name : d.data.route_name === dataObj.route_name);
            
        barSvg.selectAll(".bar")
            .classed("muted", d => !targetRoutes.includes(d.route_name))
            .classed("highlight", d => targetRoutes.includes(d.route_name));

        let tipHtml = type === "global_airport" 
            ? `<strong>機場：</strong> ${dataObj.name}<br/><strong>關聯總流量：</strong> ${dataObj.value.toLocaleString()} 人`
            : `<strong>航線：</strong> ${dataObj.route_name}<br/><strong>載客人數：</strong> ${(dataObj.passengers || dataObj.value).toLocaleString()} 人<br/><strong>載客率：</strong> ${dataObj.load_factor}%`;

        tooltip.style("opacity", 1).html(tipHtml)
            .style("left", (event.pageX + 15) + "px")
            .style("top", (event.pageY - 28) + "px");
    }

    function handleMouseOut() {
        mapSvg.selectAll(".route-arc").classed("muted highlight", false);
        treeSvg.selectAll(".treemap-node").classed("muted highlight", false);
        barSvg.selectAll(".bar").classed("muted highlight", false);
        tooltip.style("opacity", 0);
    }

    // ==========================================
    // 動態過濾 (點擊機場觸發)
    // ==========================================
    function filterByAirport(airportName) {
        // 【隱含操作】：若點擊同一個機場，視同取消過濾
        if (currentSelectedAirport === airportName) {
            resetFilter();
            return; 
        }
        currentSelectedAirport = airportName;

        mapSvg.selectAll(".route-arc").transition().duration(400)
            .style("opacity", d => (d.origin_name === airportName || d.dest_name === airportName) ? 1 : 0.05);

        const filteredFlow = globalFlowData.filter(d => d.origin_name === airportName || d.dest_name === airportName);
        renderBarchart(filteredFlow);
        renderTreemap(airportName);
    }

    function resetFilter() {
        if (!currentSelectedAirport) return;
        currentSelectedAirport = null;

        mapSvg.selectAll(".route-arc").transition().duration(400).style("opacity", null);
        renderBarchart(globalFlowData);
        renderTreemap(null);
    }
});