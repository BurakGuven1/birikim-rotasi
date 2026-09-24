export interface Bar {
  /** YYYY-MM-DD */
  date: string;
  open: number;
  high: number;
  low: number;
  /** Temettü/bölünme düzeltmeli kapanış (varsa) */
  close: number;
  volume: number;
}

export interface Point {
  date: string;
  value: number;
}
