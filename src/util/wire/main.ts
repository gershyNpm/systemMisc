export type WireInst = BaseCls & { encode: () => WireData };
export type WireDecode<Inst extends WireInst> = (enc: ReturnType<Inst['encode']>) => WireInst
export type WireCtor<I extends WireInst> = { new (inp: ReturnType<I['encode']>): BaseCls & I };
export type MakeClsInp<Inst extends WireInst> = {
  
  name: string,
  Cls: WireCtor<Inst>,
  
};
export abstract class BaseCls {
  
  public static clsName = 'BaseCls';
  
  public abstract encode(): Obj<WireData>;
  
};

export const makeCls = <Ctor extends WireInst>(inp: MakeClsInp<Ctor>) => {
  
  return class WireCls extends inp.Cls {
    
    public static name    = inp.name;
    public static clsName = inp.name;
    
  };
  
};

type WireData = undefined | null | boolean | number | string | WireInst | WireData[] | { [K: string]: WireData };
export class Wire<Registry extends Obj<WireCtor<any> & { clsName: string }>> {
  
  protected static opKey = '$$';
  protected static dummyParam = new Proxy({}, { get(t, p, r) { return r; } });
  protected registry: Registry;
  
  constructor(inp: Registry) {
    
    for (let k in inp)
      if (k !== inp[k].clsName)
        throw Error('registry key invalid')[cl.mod]({ key: k, clsName: inp[k].clsName });
    
    this.registry = inp;
    
  }
  
  protected encodeZoo(val: WireData, heap: Json[], seen: Map<WireData, number>) {
    
    if (cl.inCls(val, BaseCls)) {
      const obj = val.encode()[cl.map](val => this.encode({ val, heap, seen }).ind);
      return {
        [Wire.opKey]: `cls:${(val.constructor as any as { clsName: string}).clsName}`,
        obj
      };
    }
    
    if (cl.isCls(val, Object)) {
      const obj = val[cl.map](val => this.encode({ val, heap, seen }).ind);
      return cl.isCls(val[Wire.opKey], String)
        ? { [Wire.opKey]: 'obj', obj: obj }
        : obj;
    }
    
    if (cl.isCls(val, Array)) {
      return val[cl.map](val => this.encode({ val, heap, seen }).ind);
    }
    
    return val;
    
  }
  
  public encode(inp: { val: WireData, heap?: Json[], seen?: Map<WireData, number> }): { heap: Json[], ind: number } {
    
    const { val, heap = [], seen = new Map() } = inp;
    
    if (seen.has(val)) return { heap, ind: seen.get(val)! };
    
    const ind = heap.length;
    seen.set(val, ind);
    heap.push(null); // Reserve `heap[ind]`
    heap[ind] = this.encodeZoo(val, heap, seen);
    
    return { heap, ind };
    
  }
  
  public decode(inp: { heap: Json[], ind?: number, seen?: Map<number, WireData> }): WireData {
    
    const { heap, ind = 0, seen = new Map() } = inp;
    
    if (seen.has(ind)) return seen.get(ind);
    
    let val = heap[ind];
    
    if (cl.isCls(val, Object) && cl.isCls(val[Wire.opKey], String)) {
      
      const { [Wire.opKey]: opKey, ...props } = val as Obj<Json>; 
      
      if (!cl.isCls(opKey, String)) throw Error('nonstring op key invalid')[cl.mod]({ ind, opKey });
      const [ op, v = '<none>' ] = opKey[cl.cut](':');
      
      if (op === 'cls') {
        
        if (!this.registry[cl.has](v))    throw Error('decode cls name invalid')[cl.mod]({ ind, cls: v });
        if (!cl.isCls(props.obj, Object)) throw Error('decode cls obj invalid')[cl.mod]({ ind, obj: props.obj });
        
        const Cls = this.registry[v];
        const inst = new Cls(Wire.dummyParam); // Slightly hacky(?) way to force access to an instance without needing its constructor params
        seen.set(ind, inst);
        
        const decData = (props.obj as Obj<number>)[cl.map](ind => this.decode({ heap, ind }));
        Object.assign(inst, new Cls(decData)); // Now force-feed the actual data into the class instance
        return inst;
        
      }
      
      if (op === 'obj') {
        
        if (!cl.isCls(props.obj, Object)) throw Error('decode obj invalid')[cl.mod]({ ind, props });
        val = props.obj; // Just unwrap the object and let it flow through
        
      } 
      
    }
    
    if (cl.isCls(val, Object)) {
      
      const obj = {};
      seen.set(ind, obj);
      for (let k in val) obj[k] = this.decode({ heap, ind: (val as Obj<number>)[k], seen })
      return obj;
      
    }
    
    if (cl.isCls(val, Array)) {
      
      const arr = new Array(val.length);
      seen.set(ind, arr);
      for (let i = 0; i < val.length; i++)
        arr[i] = this.decode({ heap, ind: (val as number[])[i], seen });
      return arr;
      
    }
    
    return val;
    
  }
  
};