// map.js - Complete bike traffic visualization

// Import libraries as ES modules
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// ============================================
// GLOBAL VARIABLES & HELPER FUNCTIONS
// ============================================

// Your Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1IjoiY2F0MDIwIiwiYSI6ImNtcDYxZHJtYjA0eHUyc29sdnR1cWRuOTcifQ.dFhmVI7udY3WbeTXXBKDNQ';

// Performance optimization: pre-group trips by minute
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Helper: Convert minutes since midnight to formatted time string
function formatTime(minutes) {
    if (minutes === -1) return '';
    const date = new Date(0, 0, 0, 0, minutes);
    return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Helper: Get minutes since midnight from a Date object
function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

// Helper: Filter trips by minute using pre-computed buckets
function filterByMinute(tripsByMinute, minute) {
    if (minute === -1) {
        return tripsByMinute.flat();
    }
    
    let minMinute = (minute - 60 + 1440) % 1440;
    let maxMinute = (minute + 60) % 1440;
    
    if (minMinute > maxMinute) {
        let beforeMidnight = tripsByMinute.slice(minMinute);
        let afterMidnight = tripsByMinute.slice(0, maxMinute);
        return beforeMidnight.concat(afterMidnight).flat();
    } else {
        return tripsByMinute.slice(minMinute, maxMinute).flat();
    }
}

// Helper: Convert station coordinates to pixel positions
function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat);
    const { x, y } = map.project(point);
    return { cx: x, cy: y };
}

// Helper: Get actual hex color based on departure ratio
function getStationColorHex(station) {
    if (station.totalTraffic === 0) {
        return '#2f83e3'; // Balanced green
    }
    
    const ratio = station.departures / station.totalTraffic;
    
  
    if (ratio < 0.33) {
        return '#eece18'; 
    } else if (ratio > 0.66) {
        return '#f60eb8';  
    } else {
        return '#2f83e3'; 
    }
}

// Core function: Compute station traffic from filtered trips
function computeStationTraffic(stations, timeFilter = -1) {
    // Get filtered trips efficiently using pre-computed buckets
    const departuresList = filterByMinute(departuresByMinute, timeFilter);
    const arrivalsList = filterByMinute(arrivalsByMinute, timeFilter);
    
    // Compute departures per station
    const departures = d3.rollup(
        departuresList,
        (v) => v.length,
        (d) => d.start_station_id
    );
    
    // Compute arrivals per station
    const arrivals = d3.rollup(
        arrivalsList,
        (v) => v.length,
        (d) => d.end_station_id
    );
    
    // Update each station with computed values
    return stations.map((station) => {
        let id = station.short_name;
        station.arrivals = arrivals.get(id) ?? 0;
        station.departures = departures.get(id) ?? 0;
        station.totalTraffic = station.arrivals + station.departures;
        return station;
    });
}

// ============================================
// MAIN MAP INITIALIZATION
// ============================================

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-71.09415, 42.36027],
    zoom: 12,
    minZoom: 10,
    maxZoom: 18
});

// Wait for map to load before adding data
map.on('load', async () => {
    console.log('Map loaded, fetching data...');
    
    // ========================================
    // Step 2: Add Bike Lanes (Boston)
    // ========================================
    
    // Define common line styling
    const bikeLaneStyle = {
        'line-color': '#2ecc71',
        'line-width': 3,
        'line-opacity': 0.6
    };
    
    // Add Boston bike lanes
    try {
        map.addSource('boston_bike_lanes', {
            type: 'geojson',
            data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
        });
        
        map.addLayer({
            id: 'boston-bike-lanes',
            type: 'line',
            source: 'boston_bike_lanes',
            paint: bikeLaneStyle
        });
        console.log('Boston bike lanes added');
    } catch (error) {
        console.error('Error adding bike lanes:', error);
    }
    
    // ========================================
    // Step 3: Load Station Data
    // ========================================
    
    // Select SVG overlay
    const svg = d3.select('#map').select('svg');
    
    // Fetch station data
    let stations;
    try {
        const stationData = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
        stations = stationData.data.stations;
        console.log('Stations loaded:', stations.length);
    } catch (error) {
        console.error('Error loading stations:', error);
        return;
    }
    
    // ========================================
    // Step 4: Load and Process Trip Data
    // ========================================
    
    // Fetch and parse trip data
    const trips = await d3.csv(
        'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
        (trip) => {
            trip.started_at = new Date(trip.started_at);
            trip.ended_at = new Date(trip.ended_at);
            return trip;
        }
    );
    
    console.log('Trips loaded:', trips.length);
    
    // Pre-populate minute buckets for performance
    departuresByMinute = Array.from({ length: 1440 }, () => []);
    arrivalsByMinute = Array.from({ length: 1440 }, () => []);
    
    trips.forEach((trip) => {
        const startMinute = minutesSinceMidnight(trip.started_at);
        const endMinute = minutesSinceMidnight(trip.ended_at);
        departuresByMinute[startMinute].push(trip);
        arrivalsByMinute[endMinute].push(trip);
    });
    
    // Compute initial station traffic (no filter)
    stations = computeStationTraffic(stations, -1);
    
    // ========================================
    // Create Radius Scale (Square Root for Area)
    // ========================================
    
    const maxTraffic = d3.max(stations, d => d.totalTraffic) || 1;
    let radiusScale = d3.scaleSqrt()
        .domain([0, maxTraffic])
        .range([0, 25]);
    
    // ========================================
    // Draw Station Circles
    // ========================================
    
    // Append circles to SVG
    let circles = svg
        .selectAll('circle')
        .data(stations, (d) => d.short_name)
        .enter()
        .append('circle')
        .attr('r', (d) => radiusScale(d.totalTraffic))
        .attr('stroke', 'white')
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.8)
        .attr('fill', (d) => getStationColorHex(d))
        .each(function(d) {
            // Add tooltip with exact numbers
            const ratio = d.totalTraffic === 0 ? 0 : (d.departures / d.totalTraffic * 100).toFixed(1);
            d3.select(this)
                .append('title')
                .text(`${d.name}\n━━━━━━━━━━━━━━━━\n📊 Total: ${d.totalTraffic} trips\n🚲 Departures: ${d.departures}\n📍 Arrivals: ${d.arrivals}\n📈 Flow: ${ratio}% departures`);
        });
    
    // ========================================
    // Position Update Function
    // ========================================
    
    function updatePositions() {
        circles
            .attr('cx', (d) => getCoords(d).cx)
            .attr('cy', (d) => getCoords(d).cy);
    }
    
    // Initial position update
    updatePositions();
    
    // Update positions on map interactions
    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);
    
    // ========================================
    // Step 5: Interactive Time Filter
    // ========================================
    
    // Get DOM elements
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');
    
    // Function to update scatterplot based on time filter
    function updateScatterPlot(timeFilter) {
        // Adjust radius scale based on whether filtering is active
        if (timeFilter === -1) {
            radiusScale.range([0, 25]);
        } else {
            radiusScale.range([3, 50]);
        }
        
        // Recompute station traffic with filter
        const filteredStations = computeStationTraffic(stations, timeFilter);
        
        // Update circles with new data
        circles = circles
            .data(filteredStations, (d) => d.short_name);
        
        // Update existing circles
        circles
            .attr('r', (d) => radiusScale(d.totalTraffic))
            .attr('fill', (d) => getStationColorHex(d))
            .each(function(d) {
                // Update tooltip
                const ratio = d.totalTraffic === 0 ? 0 : (d.departures / d.totalTraffic * 100).toFixed(1);
                d3.select(this).select('title')
                    .text(`${d.name}\n━━━━━━━━━━━━━━━━\n📊 Total: ${d.totalTraffic} trips\n🚲 Departures: ${d.departures}\n📍 Arrivals: ${d.arrivals}\n📈 Flow: ${ratio}% departures`);
            });
        
        // Handle new circles (if any)
        circles.enter()
            .append('circle')
            .attr('r', (d) => radiusScale(d.totalTraffic))
            .attr('stroke', 'white')
            .attr('stroke-width', 1.5)
            .attr('opacity', 0.8)
            .attr('fill', (d) => getStationColorHex(d))
            .each(function(d) {
                const ratio = d.totalTraffic === 0 ? 0 : (d.departures / d.totalTraffic * 100).toFixed(1);
                d3.select(this).append('title')
                    .text(`${d.name}\n━━━━━━━━━━━━━━━━\n📊 Total: ${d.totalTraffic} trips\n🚲 Departures: ${d.departures}\n📍 Arrivals: ${d.arrivals}\n📈 Flow: ${ratio}% departures`);
            });
        
        // Remove circles for stations with no data
        circles.exit().remove();
        
        // Recalculate positions for all circles
        updatePositions();
    }
    
    // Function to update time display when slider changes
    function updateTimeDisplay() {
        const timeFilter = Number(timeSlider.value);
        
        if (timeFilter === -1) {
            selectedTime.textContent = '';
            anyTimeLabel.style.display = 'block';
            anyTimeLabel.textContent = '(All Day)';  // FIXED: Shows "All Day" instead of empty
        } else {
            selectedTime.textContent = formatTime(timeFilter);
            anyTimeLabel.style.display = 'none';
        }
        
        // Update the visualization
        updateScatterPlot(timeFilter);
    }
    
    // Add event listener to slider
    timeSlider.addEventListener('input', updateTimeDisplay);
    
    // Initial call to set up display
    updateTimeDisplay();
    
    console.log('All data loaded and visualization ready!');
    console.log('Sample station colors:', stations.slice(0, 3).map(s => ({
        name: s.name,
        total: s.totalTraffic,
        departures: s.departures,
        arrivals: s.arrivals,
        ratio: s.totalTraffic === 0 ? 0 : (s.departures / s.totalTraffic).toFixed(2),
        color: getStationColorHex(s)
    })));
});

// Log that Mapbox is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);