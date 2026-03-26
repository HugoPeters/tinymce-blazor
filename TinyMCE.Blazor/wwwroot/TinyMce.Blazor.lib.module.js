const CreateScriptLoader = () => {
  let unique = 0;

  const uuid = (prefix) => {
    const time = Date.now();
    const random = Math.floor(Math.random() * 1000000000);
    unique++;
    return prefix + '_' + random + unique + String(time);
  };
  const state = {
    scriptId: uuid('tiny-script'),
    listeners: [],
    scriptLoaded: false
  };

  const injectScript = (scriptId, doc, url, injectionCallback) => {
    const scriptTag = doc.createElement('script');
    scriptTag.referrerPolicy = 'origin';
    scriptTag.type = 'application/javascript';
    scriptTag.id = scriptId;
    scriptTag.src = url;

    const handler = () => {
      scriptTag.removeEventListener('load', handler);
      injectionCallback();
    };
    scriptTag.addEventListener('load', handler);
    if (doc.head) {
      doc.head.appendChild(scriptTag);
    }
  };

  const load = (doc, url, cb) => {
    if (state.scriptLoaded) {
      cb();
    } else {
      state.listeners.push(cb);
      if (!doc.getElementById(state.scriptId)) {
        injectScript(state.scriptId, doc, url, () => {
          state.listeners.forEach((fn) => fn());
          state.scriptLoaded = true;
        });
      }
    }
  }

  return {
    load
  }
}

if (!window.tinymceBlazorLoader) {
  window.tinymceBlazorLoader = CreateScriptLoader();
}

const getGlobal = () => (typeof window !== 'undefined' ? window : global);

const getTiny = () => {
  const global = getGlobal();
  return global && global.hugerte ? global.hugerte : null;
};

const updateTinyVal = (id, val) => {
  if (getTiny() && getTiny().get(id).getContent() !== val) {
    getTiny().get(id).setContent(val);
  }
};

function setCaretFromPoint(editor, x, y) {
  const doc = editor.getDoc();
  let range = null;

  // Chrome / Edge / Safari
  if (doc.caretRangeFromPoint) {
    range = doc.caretRangeFromPoint(x, y);
  }
  // Firefox
  else if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      range = doc.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }

  if (range) {
    editor.selection.setRng(range);
  }
}

function forceCaret(editor, x, y, duration = 100) {
  const start = performance.now();

  const apply = () => {
    if (performance.now() - start > duration) return;

    setCaretFromPoint(editor, x, y);
    requestAnimationFrame(apply);
  };

  requestAnimationFrame(apply);
}


const tinyEventHandler = (() => {
  const eventCache = {};
  const bindEvent = (editor, event, fn) => {
    if (!eventCache[editor.id]) eventCache[editor.id] = [];
    eventCache[editor.id].push({ name: event, fn });
    editor.on(event, fn);
  };
  const unbindEditor = (editorId) => {
    const editor = getTiny().get(editorId);
    eventCache[editorId].forEach((event, i) => {
      editor.off(event.name, event.fn);
    });
    delete eventCache.editorId;
  };
  return {
    bindEvent,
    unbindEditor
  }
})();

const chunkMap = (() => {
  const map = new Map();
  const next = (streamId, editorId, val, index, size) => {
    const acc = (map.has(streamId) ? map.get(streamId) : "") + val;
    if (index === size) {
      updateTinyVal(editorId, acc);
      map.delete(streamId);
    } else {
      map.set(streamId, acc);
    }
  };
  return {
    push: next
  };
})();

window.tinymceBlazorWrapper = {
  insertContent: (id, content, args) => {
    const tiny = getTiny().get(id);
    tiny?.insertContent(content, args);
  },
  updateMode: (id, mode) => {
    const tiny = getTiny().get(id);
    if (tiny.mode && typeof tiny.mode.set === 'function') {
      tiny.mode.set(mode);
    } else {
      tiny.setMode(mode);
    }
  },
  updateDisabled: (id, disable) => {
    const tiny = getTiny().get(id);
    if (tiny.options && typeof tiny.options.set === 'function') {
      tiny.options.set('disabled', disable);
    } else {
      tiny.mode.set(disable ? 'disabled' : 'design');
    }
  },
  updateValue: (id, streamId, value, index, chunks) => {
    chunkMap.push(streamId, id, value, index, chunks);
  },
  init: (el, blazorConf, dotNetRef) => {
    const chunkSize = 16 * 1024;
    const update = (format, content) => {
      const updateFn = format === 'text' ? 'UpdateText' : 'UpdateModel';
      const chunks = Math.floor(content.length / chunkSize) + 1;
      const streamId = (Date.now() % 100000) + '';
      for (let i = 0; i < chunks; i++) {
        const chunk = content.substring(chunkSize * i, chunkSize * (i + 1));
        dotNetRef.invokeMethodAsync(updateFn, streamId, i + 1, chunk, chunks);
      }
    };
    const getJsObj = (objectPath) => {
      const jsConf = (objectPath !== null && typeof objectPath === 'string') ? objectPath.split('.').reduce((acc, current) => {
        return acc !== undefined ? acc[current] : undefined;
      }, window) : undefined;
      return (jsConf !== undefined && typeof jsConf === 'object') ? jsConf : {};
    };
    const tinyConf = { ...getJsObj(blazorConf.jsConf), ...blazorConf.conf };
    if (blazorConf.licenseKey) {
      tinyConf.license_key = blazorConf.licenseKey;
    }
    tinyConf.inline = blazorConf.inline;
    tinyConf.readonly = blazorConf.readonly;
    tinyConf.disabled = blazorConf.disabled;
    tinyConf.target = el;
    tinyConf._setup = tinyConf.setup;
    tinyConf.setup = (editor) => {

      editor.once('focus', () => {
        if (blazorConf.conf.tzSetCaretOnInit) {
          forceCaret(editor, blazorConf.conf.tzCaretClientPos.x, blazorConf.conf.tzCaretClientPos.y);
          blazorConf.conf.tzSetCaretOnInit = false;
        }
      });

      if (blazorConf.tzWatchBlur) {
        tinyEventHandler.bindEvent(editor, 'blur', (e) => { dotNetRef.invokeMethodAsync('OnBlur'); });
      }

      tinyEventHandler.bindEvent(editor, 'init', (e) => dotNetRef.invokeMethodAsync('GetValue').then(value => { editor.setContent(value); }));
      tinyEventHandler.bindEvent(editor, 'change', (e) => { dotNetRef.invokeMethodAsync('OnChange'); });
      tinyEventHandler.bindEvent(editor, 'input', (e) => { dotNetRef.invokeMethodAsync('OnInput'); });
      tinyEventHandler.bindEvent(editor, 'setcontent', (e) => update('text', editor.getContent({ format: 'text' })));
      tinyEventHandler.bindEvent(editor, blazorConf.modelEvents, (e) => {
        update('html', editor.getContent());
        update('text', editor.getContent({ format: 'text' }));
      });
      if (tinyConf._setup && typeof tinyConf._setup === 'function') {
        tinyConf._setup(editor, tinyEventHandler);
      }
    }

    tinyConf.init_instance_callback = (editor) => {
      if (blazorConf.tzFocusOnInit) {
        editor.focus();
      }
    }

    if (getTiny()) {
      getTiny().init(tinyConf);
    } else {
      if (el && el.ownerDocument) {
        // inject tiny here
        window.tinymceBlazorLoader.load(el.ownerDocument, blazorConf.src, () => {
          getTiny().init(tinyConf);
        });
      }
    }
  },
  destroy: (el, id) => {
    if (getTiny() && getTiny().get(id)) {
      tinyEventHandler.unbindEditor(id);
      getTiny().get(id).remove();
    }
  }
}
