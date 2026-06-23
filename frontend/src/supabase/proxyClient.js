const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';

async function proxyCall(method, table, options = {}) {
  const res = await fetch(`${API_BASE}/supabaseProxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, table, ...options }),
  });
  const result = await res.json();
  if (!result.success) throw { message: result.error || 'Proxy error', status: res.status };
  return result.data;
}

function makeThenable(executor) {
  const p = new Promise(executor);
  p.then = p.then.bind(p);
  p.catch = p.catch.bind(p);
  p.finally = p.finally.bind(p);
  return p;
}

function makeWriteThenable(method, table, { data, id, filters, options } = {}) {
  return makeThenable((resolve, reject) => {
    proxyCall(method, table, { data, id, filters, options })
      .then(data => resolve({ data, error: null }))
      .catch(err => resolve({ data: null, error: { message: err.message } }));
  });
}

function makeQueryBuilder(table) {
  const filters = [];
  let selectCols = '*';
  let orderByField = null;
  let orderAsc = true;
  let limitVal = null;
  let isSingle = false;

  function cloneFilters() {
    return filters.map(f => ({ ...f }));
  }

  function buildSelectThenable() {
    return makeThenable((resolve, reject) => {
      proxyCall('select', table, {
        select: selectCols,
        filters: cloneFilters(),
        options: { orderBy: orderByField, ascending: orderAsc, limit: limitVal },
      }).then(data => {
        resolve({ data: isSingle ? (data?.[0] || null) : data, error: null });
      }).catch(err => {
        resolve({ data: null, error: { message: err.message } });
      });
    });
  }

  const builder = {
    select(columns) {
      selectCols = columns || '*';
      return builder;
    },
    eq(field, value) {
      filters.push({ field, op: 'EQUAL', value });
      return builder;
    },
    neq(field, value) {
      filters.push({ field, op: 'NOT_EQUAL', value });
      return builder;
    },
    in(field, value) {
      filters.push({ field, op: 'IN', value });
      return builder;
    },
    ilike(field, value) {
      filters.push({ field, op: 'LIKE', value });
      return builder;
    },
    order(column, opts = {}) {
      orderByField = column;
      orderAsc = opts.ascending !== false;
      return builder;
    },
    limit(n) {
      limitVal = n;
      return builder;
    },
    single() {
      isSingle = true;
      return builder;
    },
    maybeSingle() {
      isSingle = true;
      return builder;
    },
    then(resolve, reject) {
      return buildSelectThenable().then(resolve, reject);
    },
    catch(reject) {
      return this.then(undefined, reject);
    },

    update(data) {
      const p = makeWriteThenable('update', table, { data, filters: cloneFilters() });
      const chain = {
        eq(field, value) {
          filters.push({ field, op: 'EQUAL', value });
          return chain;
        },
        in(field, value) {
          filters.push({ field, op: 'IN', value });
          return chain;
        },
        then(resolve, reject) { return p.then(resolve, reject); },
        catch(reject) { return p.catch(reject); },
      };
      return chain;
    },
    insert(data) {
      return makeWriteThenable('insert', table, { data });
    },
    upsert(data) {
      return makeWriteThenable('upsert', table, { data });
    },
    delete() {
      const chain = {
        eq(field, value) {
          filters.push({ field, op: 'EQUAL', value });
          return chain;
        },
        in(field, value) {
          filters.push({ field, op: 'IN', value });
          return chain;
        },
        then(resolve, reject) {
          return makeWriteThenable('delete', table, { filters: cloneFilters() }).then(resolve, reject);
        },
        catch(reject) {
          return this.then(undefined, reject);
        },
      };
      return chain;
    },
  };

  return builder;
}

function noopSubscribe() {
  return () => {};
}

const proxyHandler = {
  from(table) {
    return makeQueryBuilder(table);
  },
  channel() {
    const channel = {
      on() { return channel; },
      subscribe() {},
      unsubscribe() {},
    };
    return channel;
  },
  removeChannel() {},
  removeAllChannels() {},
  auth: {
    getSession() { return Promise.resolve({ data: { session: null }, error: null }); },
    signOut() { return Promise.resolve({ error: null }); },
  },
  realtime: { subscribe: noopSubscribe },
};

export default proxyHandler;
