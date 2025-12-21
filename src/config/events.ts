export type EventItem = {
  title: string;
  time: string;
  impact: 'low' | 'med' | 'high';
};

export const UPCOMING_EVENTS: EventItem[] = [];
