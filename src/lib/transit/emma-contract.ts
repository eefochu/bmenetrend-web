// Fixed official MÁV queries shared by the browser and the bounded local adapter.
export const OFFICIAL_EMMA_URL =
  "https://mavplusz.hu/otp2-backend/otp/routers/default/index/graphql";
const ROUTE = "gtfsId shortName longName mode color";
const STOP = `gtfsId name lat lon vehicleMode platformCode locationType routes { ${ROUTE} }`;
export const EMMA_QUERIES = {
  stops: `query MapStopsInArea($south:Float!,$west:Float!,$north:Float!,$east:Float!){stopsByBbox(minLat:$south,minLon:$west,maxLat:$north,maxLon:$east){${STOP}}}`,
  vehicles: `query RailVehicles($south:Float!,$west:Float!,$north:Float!,$east:Float!){vehiclePositions(swLat:$south,swLon:$west,neLat:$north,neLon:$east,modes:[RAIL,TRAMTRAIN]){vehicleId lat lon heading label lastUpdated trip{gtfsId tripShortName tripHeadsign route{${ROUTE}}}}}`,
  search: `query FindStops($name:String!){stops(name:$name){${STOP}}}`,
  board: `query StopBoard($id:String!,$start:Long!,$range:Int!){stop(id:$id){stoptimesWithoutPatterns(startTime:$start,timeRange:$range,numberOfDepartures:50,omitNonPickups:true){scheduledDeparture realtimeDeparture realtime realtimeState serviceDay headsign trip{gtfsId tripHeadsign route{${ROUTE}}}}}}`,
  trip: `query VehicleTrip($id:String!){trip(id:$id){gtfsId tripHeadsign geometry route{${ROUTE}} stops{${STOP}} stoptimes{scheduledArrival realtimeArrival scheduledDeparture realtimeDeparture realtime serviceDay}}}`,
  plan: planQuery(false),
  planWalkAverse: planQuery(true),
} as const;

/**
 * TripPlanner.query (Android): EMMA's national planner, the fallback when BKK fails, times out or has
 * nothing, and (walk-averse, walkReluctance 5) the extra search when every BKK journey walks a long way.
 */
function planQuery(avoidWalking: boolean) {
  return `query TripPlan($from:String!,$to:String!,$date:String!,$time:String!){plan(fromPlace:$from,toPlace:$to,date:$date,time:$time,arriveBy:false,${avoidWalking ? "walkReluctance:5.0," : ""}walkSpeed:1.15,minTransferTime:180,boardSlack:60,alightSlack:30,numItineraries:12,maxTransfers:4,omitCanceled:true,transportModes:[{mode:WALK},{mode:TRANSIT}],ignoreRealtimeUpdates:false){itineraries{startTime endTime legs{mode startTime endTime distance realTime transitLeg interlineWithPreviousLeg from{name lat lon stop{gtfsId name platformCode}} to{name lat lon stop{gtfsId name platformCode}} route{gtfsId shortName longName mode color} trip{gtfsId tripShortName tripHeadsign} intermediateStops{name lat lon}}} routingErrors{code description}}}`;
}
export type EmmaOperation = keyof typeof EMMA_QUERIES;
