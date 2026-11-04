import '@gershy/clearing';
import { assertEqual, cmpAny, hasProps, testRunner } from '../../../build/utils.test.ts';
import { entry } from '@gershy/entry';
import { BaseCls, makeCls, Wire } from './main.ts';

Error.stackTraceLimit = 200;

const codec = { type: 'rec', props: {
  reg:    { type: 'str', map: (str: string) => new RegExp(str) },
  effort: { type: 'enum', opts: [ 0, 1, 2, 3, 4, 5, 6 ] }
}} as const;
entry({ name: 'test', codec, inp: { reg: '^', effort: 0 }, fn: async (logger, { reg, effort, ...inp }) => {
  
  // Type testing
  (async () => {
    
    type Enforce<Provided, Expected extends Provided> = { provided: Provided, expected: Expected };
    
    type Tests = {
      1: Enforce<{ x: 'y' }, { x: 'y' }>,
    };
    if (0) ((v?: Tests) => void 0)();
    
  })();
  
  await testRunner({ logger, reg, effort, inp, cases: [
    
    { name: 'basic', fn: async logger => {
      
      type TestPar = InstanceType<typeof TestPar>;
      const TestPar = makeCls({ name: 'TestPar', Cls: class C extends BaseCls {
        
        public age: number;
        public kids: TestKid[];
        constructor(inp: { age: number, kids: TestKid[] }) {
          super();
          this.age = inp.age;
          this.kids = inp.kids;
        }
        
        encode() { return { age: this.age, kids: this.kids }; }
        
      }});
      
      type TestKid = InstanceType<typeof TestKid>;
      const TestKid = makeCls({ name: 'TestKid', Cls: class C extends BaseCls {
        
        public name: string;
        public whatever: any;
        constructor(inp: { data: { name: string }, whatever?: any }) {
          super();
          this.name = inp.data.name; // Tests that any inp -> property transformations are preserved
          this.whatever = inp.whatever ?? null;
        }
        
        encode(): { data: { name: string }, whatever?: any } {
          return { data: { name: this.name }, whatever: this.whatever };
        }
        
      }});
      
      const par = new TestPar({ age: 30, kids: [
        new TestKid({ data: { name: 'testKid1' } }),
        new TestKid({ data: { name: 'testKid2' }, whatever: { $$: 'xxx' } })
      ]});
      
      assertEqual(par, [ hasProps, {
        age: 30,
        kids: [
          [ hasProps, { name: 'testKid1', whatever: null } ],
          [ hasProps, { name: 'testKid2', whatever: { $$: 'xxx' } } ]
        ]
      }]);
      
      const wire = new Wire({ TestPar, TestKid });
      const par2 = wire.decode(wire.encode({ val: par })) as TestPar;
      assertEqual(par2, [ hasProps, {
        age: 30,
        kids: [
          [ hasProps, { name: 'testKid1', whatever: null } ],
          [ hasProps, { name: 'testKid2', whatever: { $$: 'xxx' } } ]
        ]
      }]);
      
      assertEqual(par === par2, false);
      assertEqual(par.kids[1] === par2.kids[1], false);
      
    }},
    
    { name: 'wire cycle', fn: async logger => {
      
      const cycle: any = { a: { b: { c: null } } };
      cycle.a.b.c = cycle;
      
      const wire = new Wire({});
      const cycle2 = wire.decode(wire.encode({ val: cycle }));
      assertEqual(cycle2 === cycle, false);
      assertEqual(cycle2, [ hasProps, { a: { b: { c: cmpAny } } } ]);
      assertEqual(cycle2, { a: { b: { c: cycle2 } } });
      
    }},
    
    { name: 'infinity', fn: async logger => {
      
      const wire = new Wire({});
      const val = { pos: Infinity, neg: -Infinity };
      const encoded = JSON.parse(JSON.stringify(wire.encode({ val })));
      const decoded = wire.decode(encoded);
      assertEqual(decoded, val);
      assertEqual(wire.clone([ Infinity, -Infinity ]), [ Infinity, -Infinity ]);
      
    }},
    
    { name: 'wire cycle ducktype instance', fn: async logger => {
      
      // Note this also tests a ducktyped `BaseCls` - `Boiii` doesn't actually extend `BaseCls`
      
      class Boiii {
        
        public static readonly clsName = 'Boiii';
        
        public data: any;
        constructor(inp: { data: Boiii['data'] }) {
          this.data = inp.data;
        }
        encode() { return { data: this.data }; }
        
      };
      
      const cycleBoi = new Boiii({ data: {
        
        a: { b: { c: null } },
        someone: new Boiii({ data: 'someone' })
        
      }});
      cycleBoi.data.a.b.c = cycleBoi;
      
      const wire = new Wire({ Boiii });
      const cycleBoi2 = wire.clone(cycleBoi);
      assertEqual(cycleBoi2 === cycleBoi, false);
      assertEqual(cycleBoi2, [ hasProps, {
        data: {
          a: { b: { c: cycleBoi2 } },
          someone: [ hasProps, { data: 'someone' }]
        }
      }]);
      
    }}
    
  ]});
  
}});