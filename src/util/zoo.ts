export type Exhibit<V> = [ new (...args: any[]) => V, {
  inherit?: boolean,
  launch: ()                           => V,
  survey: (val: V)                     => Iterable<any>,
  insert: (par: V, kid: any, key: any) => void
}];

export const exhibits = {
  
  obj: [ Object, {
    launch: () => ({}),
    survey: function*(obj) { for (const k in obj) yield [ k, obj[k] ]; },
    insert: (obj, kid, key) => obj[key] = kid
  }],
  
  arr: [ Array, {
    launch: () => [],
    survey: arr => (arr as any[]).entries(),
    insert: (arr, kid) => arr.push(kid)
  }],
  
  set: [ Set, {
    launch: () => new Set(),
    survey: function*(set) { for (const kid of set) yield [ null, kid ]; },
    insert: (set, kid) => set.add(kid)
  }],
  
  map: [ Map, {
    launch: () => new Map(),
    survey: map => map.entries(),
    insert: (map, kid, key) => map.set(key, kid)
  }]
  
} satisfies Obj<Exhibit<any>>;

const immutable = new Set([ undefined, null, Boolean, Number, String ]);

export const iterate = function*(map: Exhibit<any>[], val, chain: string[] = []) {
  
  yield { chain, val };
  
  for (const [ Cls, { inherit = false, survey } ] of map) {
   
    if (!val[inherit ? 'inCls' : 'isCls'](Cls)) continue;
    
    for (const [ k, kid ] of survey(val))
      yield* iterate(map, kid, [ ...chain, k ]);
    
  }
  
};
export const clone = (map: Exhibit<any>[], val, seen = new Map()) => {
  
  if (immutable.has(cl.getCls(val))) return val;
  
  const preexisting = seen.get(val);
  if (preexisting) return preexisting;
  
  for (const [ Cls, { inherit = false, launch, survey, insert } ] of map) {
    
    if (!cl[inherit ? 'inCls' : 'isCls'](val, Cls)) continue;
    
    const v = launch();
    seen.set(val, v);
    
    for (const [ k, kid ] of survey(val))
      insert(v, clone(map, kid, seen), k);
    
    return v;
    
  }
  
  return val;
  
};
