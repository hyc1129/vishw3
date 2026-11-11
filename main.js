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

let currentSelectedOrigin = null; 
let globalFlowData = [];          
let globalTreeData = null;

Promise.all([
    d3.json("counties-10t.json"), // ⚠強烈建議：請換成未投影的 raw 經緯度 TopoJSON
    d3.json("d3_flow_map.json"),
    d3.json("d3_treemap.json")
]).then(([topoData, flowData, treeData]) => {
    
    globalFlowData = flowData;
    globalTreeData = treeData;

    const origins = treeData.children.map(d => d.name);
    const colorScale = d3.scaleOrdinal(d3.schemeTableau10).domain(origins);
    const strokeScale = d3.scaleSqrt().domain([0, d3.max(flowData, d => d.passengers)]).range([1.5, 12]);

    // ==========================================
    // View 1: 繪製地理流向圖 (Map)
    // ==========================================
    // 標準台灣麥卡托投影
    const projection = d3.geoMercator()
        .center([121, 24])
        .scale(6000)
        .translate([mapW / 2 +10, mapH / 2]);
    const pathGenerator = d3.geoPath().projection(projection);

    const mapLayer = mapSvg.append("g");
    
    const counties = topojson.feature(topoData, topoData.objects.counties).features;
    mapLayer.append("g")
        .selectAll(".county")
        .data(counties)
        .join("path")
        .attr("class", "county")
        .attr("d", pathGenerator)
        .on("click", resetFilter); // 點擊海面/空地取消選取

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
        .on("click", (event, d) => filterByOrigin(d.name)) // 綁定 Toggle 過濾
        .append("title").text(d => d.name);

    // ==========================================
    // View 2: 動態階層樹狀圖 (Treemap)
    // ==========================================
    const treeG = treeSvg.append("g").attr("transform", "translate(0, 30)");
    
    function renderTreemap(originFilter) {
        let nodeToDraw;
        let isGlobal = !originFilter;

        if (isGlobal) {
            // [修正3] 全域：自行組裝一層階層，計算各機場總流量
            const globalTree = {
                name: "全台機場",
                children: globalTreeData.children.map(d => ({
                    name: d.name,
                    value: d3.sum(d.children, c => c.value),
                    origin_name: d.name, // 標記為出發機場
                    isOrigin: true
                }))
            };
            nodeToDraw = d3.hierarchy(globalTree).sum(d => d.value).sort((a, b) => b.value - a.value);
        } else {
            // 局部過濾：找出點選的機場，畫出目的地
            const originData = globalTreeData.children.find(d => d.name === originFilter);
            nodeToDraw = d3.hierarchy(originData).sum(d => d.value).sort((a, b) => b.value - a.value);
        }

        d3.treemap().size([treeW, treeH - 40]).paddingInner(2).paddingTop(0)(nodeToDraw);

        const cells = treeG.selectAll(".tree-cell")
            // 使用 name 作為 key，保證動畫順暢過渡
            .data(nodeToDraw.leaves(), d => d.data.name);

        const enterCells = cells.enter().append("g")
            .attr("class", "tree-cell")
            .attr("transform", d => `translate(${d.x0},${d.y0})`);

        enterCells.append("rect")
            .attr("class", "treemap-node default-opacity")
            .attr("fill", d => isGlobal ? colorScale(d.data.name) : colorScale(d.parent.data.name))
            .attr("width", d => Math.max(0, d.x1 - d.x0))
            .attr("height", d => Math.max(0, d.y1 - d.y0))
            .on("mouseover", (event, d) => handleMouseOver(event, d.data, isGlobal ? "origin" : "route"))
            .on("mouseout", handleMouseOut)
            // 如果在全域點擊方塊，也能觸發過濾！
            .on("click", (event, d) => { if(isGlobal) filterByOrigin(d.data.name); });

        enterCells.append("text").attr("class", "treemap-label")
            .attr("x", 4).attr("y", 14).text(d => d.data.name);
        enterCells.append("text").attr("class", "treemap-sublabel")
            .attr("x", 4).attr("y", 26).text(d => d.data.value.toLocaleString() + "人");

        // 動畫過渡
        const updateCells = enterCells.merge(cells);
        updateCells.transition().duration(600)
            .attr("transform", d => `translate(${d.x0},${d.y0})`);
        updateCells.select("rect").transition().duration(600)
            .attr("width", d => Math.max(0, d.x1 - d.x0))
            .attr("height", d => Math.max(0, d.y1 - d.y0));
        updateCells.selectAll("text").transition().duration(600)
            .style("opacity", d => (d.x1 - d.x0) > 45 && (d.y1 - d.y0) > 30 ? 1 : 0);

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
    renderMapRoutes(flowData);
    renderTreemap(null);
    renderBarchart(flowData);

    // ==========================================
    // 核心連動：智慧判斷 Hover 是「單一航線」還是「整個機場」
    // ==========================================
    function handleMouseOver(event, dataObj, type) {
        const nameToMatch = dataObj.name || dataObj.route_name; 
        
        mapSvg.selectAll(".route-arc")
            .classed("muted", d => type === "origin" ? d.origin_name !== nameToMatch : d.route_name !== nameToMatch)
            .classed("highlight", d => type === "origin" ? d.origin_name === nameToMatch : d.route_name === nameToMatch);
            
        treeSvg.selectAll(".treemap-node")
            .classed("muted", d => {
                if (type === "origin") return d.data.name !== nameToMatch;
                return d.data.route_name !== nameToMatch;
            })
            .classed("highlight", d => {
                if (type === "origin") return d.data.name === nameToMatch;
                return d.data.route_name === nameToMatch;
            });
            
        barSvg.selectAll(".bar")
            .classed("muted", d => type === "origin" ? d.origin_name !== nameToMatch : d.route_name !== nameToMatch)
            .classed("highlight", d => type === "origin" ? d.origin_name === nameToMatch : d.route_name === nameToMatch);

        // Tooltip 內容切換
        let tipHtml = type === "origin" 
            ? `<strong>出發機場：</strong> ${nameToMatch}<br/><strong>總出發流量：</strong> ${dataObj.value.toLocaleString()} 人`
            : `<strong>航線：</strong> ${nameToMatch}<br/><strong>載客人數：</strong> ${(dataObj.passengers || dataObj.value).toLocaleString()} 人<br/><strong>載客率：</strong> ${dataObj.load_factor}%`;

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
    // 核心過濾：點擊地圖機場或樹狀圖大方塊下鑽 (含切換機制)
    // ==========================================
    function filterByOrigin(originName) {
        // [修正1] 點擊同一個機場時，自動重置過濾 (Toggle)
        if (currentSelectedOrigin === originName) {
            resetFilter();
            return; 
        }
        currentSelectedOrigin = originName;

        mapSvg.selectAll(".route-arc").transition().duration(400)
            .style("opacity", d => d.origin_name === originName ? 1 : 0.05);

        renderBarchart(globalFlowData.filter(d => d.origin_name === originName));
        renderTreemap(originName);
    }

    function resetFilter() {
        if (!currentSelectedOrigin) return;
        currentSelectedOrigin = null;

        mapSvg.selectAll(".route-arc").transition().duration(400).style("opacity", null);
        renderBarchart(globalFlowData);
        renderTreemap(null);
    }
});