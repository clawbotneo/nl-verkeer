export type RoadType = 'A' | 'N';
export type EventCategory = 'jam' | 'accident';

export interface TrafficEvent {
  id: string;
  roadType: RoadType;
  roadNumber: number;
  roadCode: string; // e.g. A8
  direction?: string;
  from?: string;
  to?: string;
  locationText?: string;
  lengthKm?: number;
  delayMin?: number;
  category: EventCategory;
  eventTypeRaw?: string;
  lastUpdated: string; // ISO
  source: 'NDW';
  sourceUrl: string;
}

export interface EventsQuery {
  type?: RoadType; // A or N
  road?: number; // 8
  category?: EventCategory; // jam or accident
  sort?: 'delay' | 'length';
}
