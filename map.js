// Import Mapbox and D3 as ES modules
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// ---------- Settings ----------
// PASTE YOUR MAPBOX PUBLIC TOKEN HERE (it starts with "pk.")
mapboxgl.accessToken = 'pk.eyJ1IjoiYXRsMDEyIiwiYSI6ImNtd2JicGowZDAxd2wyem9tNWs2YTFuaGQifQ.97MrfplyVAluBwx-pq9slg';

// Data sources. If the bike lanes don't show up, copy the exact URLs from
// the lab page (Steps 2.1 and 2.3) into these two constants.
const BOSTON_LANES_URL =
  'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson';
const CAMBRIDGE_LANES_URL =
  'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson';
const STATIONS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
const TRIPS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

// One shared style for both bike lane layers.
// (Mapbox doesn't understand oklch(), so use hex, rgb(), hsl(), or named colors.)
const bikeLanePaint = {
  'line-color': '#32D400',
  'line-width': 3,
  'line-opacity': 0.5,
};

// ---------- Step 1.3: create the map ----------
const map = new mapboxgl.Map({
  container: 'map',                        // ID of the div that holds the map
  style: 'mapbox://styles/mapbox/light-v11', // a light style makes the data easier to see
  center: [-71.09415, 42.36027],           // [longitude, latitude]
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// ---------- State ----------
let timeFilter = -1; // minutes since midnight, or -1 for "any time"
let stations = [];

// Step 5.4: trips pre-sorted into one bucket per minute of the day (24 * 60 = 1440)
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// ---------- Helper functions ----------

// Step 3.3: lon/lat -> pixel position on the current map view
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Step 5.2: 90 minutes since midnight -> "1:30 AM"
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Step 5.3: a Date -> minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Step 5.4: trips within 60 minutes before or after the selected minute
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat(); // no filtering
  }

  // Normalize to [0, 1439], handling windows that cross midnight
  const minMinute = (minute - 60 + 1440) % 1440;
  const maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    const beforeMidnight = tripsByMinute.slice(minMinute);
    const afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  }
  return tripsByMinute.slice(minMinute, maxMinute).flat();
}

// Steps 4.2 and 5.3: arrivals, departures, and total traffic per station
function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    const id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Step 4.4: text of the browser tooltip on each circle
function tooltipText(d) {
  return `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`;
}

// ---------- Everything that needs the map to be loaded ----------
map.on('load', async () => {
  // Step 2: bike lanes (Boston and Cambridge)
  map.addSource('boston_route', { type: 'geojson', data: BOSTON_LANES_URL });
  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: bikeLanePaint,
  });

  map.addSource('cambridge_route', { type: 'geojson', data: CAMBRIDGE_LANES_URL });
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLanePaint,
  });

  // Step 3.1: load the station data
  let jsonData;
  try {
    jsonData = await d3.json(STATIONS_URL);
    console.log('Loaded JSON Data:', jsonData);
  } catch (error) {
    console.error('Error loading JSON:', error);
    return;
  }

  // Step 4.1: load the trips, converting dates and filling the minute buckets
  let trips;
  try {
    trips = await d3.csv(TRIPS_URL, (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);

      departuresByMinute[minutesSinceMidnight(trip.started_at)].push(trip);
      arrivalsByMinute[minutesSinceMidnight(trip.ended_at)].push(trip);

      return trip;
    });
    console.log(`Loaded ${trips.length} trips`);
  } catch (error) {
    console.error('Error loading trips:', error);
    return;
  }

  // Step 4.2: add traffic numbers to each station
  stations = computeStationTraffic(jsonData.data.stations);
  console.log('Stations Array:', stations);

  // Step 4.3: circle area (not radius) should show traffic, so use a square root scale
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // Step 6.1: three colors for traffic flow (1 = departures, 0 = arrivals)
  const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
  const departureRatio = (d) =>
    d.totalTraffic ? stationFlow(d.departures / d.totalTraffic) : 0.5;

  // Step 3.3: one SVG circle per station
  const svg = d3.select('#map').select('svg');

  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name) // key: keeps circles matched to stations
    .join('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', departureRatio)
    .each(function (d) {
      // Step 4.4: browser tooltip
      d3.select(this).append('title').text(tooltipText(d));
    });

  // Keep the circles lined up with the map as it moves
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // ---------- Step 5: time slider ----------
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateScatterPlot(filter) {
    // Recompute traffic for the selected time window
    const filteredStations = computeStationTraffic(stations, filter);

    // Fewer trips when filtering, so use bigger circles
    filter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

    circles
      .data(filteredStations, (d) => d.short_name)
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', departureRatio)
      .select('title') // keep the tooltip numbers in sync too
      .text(tooltipText);
  }

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});