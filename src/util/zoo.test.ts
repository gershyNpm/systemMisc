import '@gershy/clearing';
import { clone, type Exhibit } from './zoo.ts';
import { assertEqual } from '../../build/utils.test.ts';

const exhibits: Exhibit<any>[] = [
  
  [ Object, {
    launch: () => ({}),
    survey: function*(obj) { for (const k in obj) yield [ k, obj[k] ]; },
    insert: (obj, v, k) => obj[k] = v
  }],
  
  [ Array, {
    launch: () => [],
    survey: arr => (arr as any[]).entries(),
    insert: (arr, kid) => arr.push(kid)
  }],
  
  [ Set, {
    launch: () => new Set(),
    survey: function*(set) { for (const kid of set) yield [ null, kid ]; },
    insert: (set, kid) => set.add(kid)
  }]
  
];

const val1 = {
  meta: { tags: new Set([ 'a', 'b', 'c' ]) },
  values: [ { name: 'bob' }, { name: 'ray' } ]
};
const val2 = clone(exhibits, val1);

assertEqual(val1, val2);
if (val1.meta === val2.meta) throw Error('reference');