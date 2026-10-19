// TODO: This should be in @gershy/util-tracked (if the "add functions, run functions in reverse order on close" paradigm is certain)
export type TrackFn = () => Promise<any>;
export type TrackAdder<T extends TrackFn> = (t: T) => { val: T, launch: () => Promise<void>, cancel: () => void };
export default async <T extends TrackFn, R>(cb: (trk: TrackAdder<T>) => Promise<R>): Promise<Awaited<R>> => {
  
  const set = new Set<T>();
  const trk = (val: T) => {
    set.add(val);
    return {
      val,
      cancel: () => set.delete(val),
      launch: () => (set.delete(val), val())
    };
  };
  
  try     { return await cb(trk); }
  finally { for (const v of [ ...set ].reverse()) await v(); } // Consider parallelizing? Or throttling?
  
};