/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {DOCUMENT, ɵgetDOM as getDOM} from '@angular/common';
import {DomElementSchemaRegistry} from '@angular/compiler';
import {APP_ID, Inject, Injectable, NgZone, Renderer2, RendererFactory2, RendererStyleFlags2, RendererType2, ViewEncapsulation} from '@angular/core';
import {EventManager, ɵNAMESPACE_URIS as NAMESPACE_URIS, ɵSharedStylesHost as SharedStylesHost, ɵshimContentAttribute as shimContentAttribute, ɵshimHostAttribute as shimHostAttribute, ɵshimStyles as shimStylesContent} from '@angular/platform-browser';

const EMPTY_ARRAY: any[] = [];

const DEFAULT_SCHEMA = new DomElementSchemaRegistry();

@Injectable()
export class ServerRendererFactory2 implements RendererFactory2 {
  private rendererByCompId = new Map<string, Renderer2>();
  private defaultRenderer: Renderer2;
  private schema = DEFAULT_SCHEMA;

  constructor(
      private eventManager: EventManager,
      private ngZone: NgZone,
      @Inject(DOCUMENT) private document: Document,
      private sharedStylesHost: SharedStylesHost,
      @Inject(APP_ID) private appId: string,
  ) {
    this.defaultRenderer = new DefaultServerRenderer2(eventManager, document, ngZone, this.schema);
  }

  createRenderer(element: any, type: RendererType2|null): Renderer2 {
    if (!element || !type) {
      return this.defaultRenderer;
    }
    switch (type.encapsulation) {
      case ViewEncapsulation.Emulated: {
        let renderer = this.rendererByCompId.get(type.id);
        if (!renderer) {
          renderer = new EmulatedEncapsulationServerRenderer2(
              this.eventManager, this.document, this.ngZone, this.sharedStylesHost, this.schema,
              type, this.appId);
          this.rendererByCompId.set(type.id, renderer);
        }

        (<EmulatedEncapsulationServerRenderer2>renderer).applyToHost(element);
        return renderer;
      }
      default: {
        if (!this.rendererByCompId.has(type.id)) {
          const styles = shimStylesContent(type.id, type.styles);
          this.sharedStylesHost.addStyles(styles);
          this.rendererByCompId.set(type.id, this.defaultRenderer);
        }
        return this.defaultRenderer;
      }
    }
  }

  begin() {}
  end() {}
}

class DefaultServerRenderer2 implements Renderer2 {
  data: {[key: string]: any} = Object.create(null);

  constructor(
      private eventManager: EventManager, protected document: any, private ngZone: NgZone,
      private schema: DomElementSchemaRegistry) {}

  destroy(): void {}

  destroyNode = null;

  createElement(name: string, namespace?: string): any {
    if (namespace) {
      const doc = this.document || getDOM().getDefaultDocument();
      return doc.createElementNS(NAMESPACE_URIS[namespace], name);
    }

    return getDOM().createElement(name, this.document);
  }

  createComment(value: string): any {
    return getDOM().getDefaultDocument().createComment(value);
  }

  createText(value: string): any {
    const doc = getDOM().getDefaultDocument();
    return doc.createTextNode(value);
  }

  appendChild(parent: any, newChild: any): void {
    const targetParent = isTemplateNode(parent) ? parent.content : parent;
    targetParent.appendChild(newChild);
  }

  insertBefore(parent: any, newChild: any, refChild: any): void {
    if (parent) {
      const targetParent = isTemplateNode(parent) ? parent.content : parent;
      targetParent.insertBefore(newChild, refChild);
    }
  }

  removeChild(parent: any, oldChild: any): void {
    if (parent) {
      parent.removeChild(oldChild);
    }
  }

  selectRootElement(selectorOrNode: string|any, preserveContent?: boolean): any {
    const el = typeof selectorOrNode === 'string' ? this.document.querySelector(selectorOrNode) :
                                                    selectorOrNode;
    if (!el) {
      throw new Error(`The selector "${selectorOrNode}" did not match any elements`);
    }
    if (!preserveContent) {
      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }
    }
    return el;
  }

  parentNode(node: any): any {
    return node.parentNode;
  }

  nextSibling(node: any): any {
    return node.nextSibling;
  }

  setAttribute(el: any, name: string, value: string, namespace?: string): void {
    if (namespace) {
      el.setAttributeNS(NAMESPACE_URIS[namespace], namespace + ':' + name, value);
    } else {
      el.setAttribute(name, value);
    }
  }

  removeAttribute(el: any, name: string, namespace?: string): void {
    if (namespace) {
      el.removeAttributeNS(NAMESPACE_URIS[namespace], name);
    } else {
      el.removeAttribute(name);
    }
  }

  addClass(el: any, name: string): void {
    el.classList.add(name);
  }

  removeClass(el: any, name: string): void {
    el.classList.remove(name);
  }

  setStyle(el: any, style: string, value: any, flags: RendererStyleFlags2): void {
    style = style.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    value = value == null ? '' : `${value}`.trim();
    const styleMap = _readStyleAttribute(el);
    if (flags & RendererStyleFlags2.Important) {
      value += ' !important';
    }
    styleMap[style] = value;
    _writeStyleAttribute(el, styleMap);
  }

  removeStyle(el: any, style: string, flags: RendererStyleFlags2): void {
    // IE requires '' instead of null
    // see https://github.com/angular/angular/issues/7916
    this.setStyle(el, style, '', flags);
  }

  // The value was validated already as a property binding, against the property name.
  // To know this value is safe to use as an attribute, the security context of the
  // attribute with the given name is checked against that security context of the
  // property.
  private _isSafeToReflectProperty(tagName: string, propertyName: string): boolean {
    return this.schema.securityContext(tagName, propertyName, true) ===
        this.schema.securityContext(tagName, propertyName, false);
  }

  setProperty(el: any, name: string, value: any): void {
    checkNoSyntheticProp(name, 'property');
    if (name === 'innerText') {
      // Domino does not support innerText. Just map it to textContent.
      el.textContent = value;
    }
    (<any>el)[name] = value;
    // Mirror property values for known HTML element properties in the attributes.
    // Skip `innerhtml` which is conservatively marked as an attribute for security
    // purposes but is not actually an attribute.
    const tagName = (el.tagName as string).toLowerCase();
    if (value != null && (typeof value === 'number' || typeof value == 'string') &&
        name.toLowerCase() !== 'innerhtml' && this.schema.hasElement(tagName, EMPTY_ARRAY) &&
        this.schema.hasProperty(tagName, name, EMPTY_ARRAY) &&
        this._isSafeToReflectProperty(tagName, name)) {
      this.setAttribute(el, name, value.toString());
    }
  }

  setValue(node: any, value: string): void {
    node.textContent = value;
  }

  listen(
      target: 'document'|'window'|'body'|any, eventName: string,
      callback: (event: any) => boolean): () => void {
    checkNoSyntheticProp(eventName, 'listener');
    if (typeof target === 'string') {
      return <() => void>this.eventManager.addGlobalEventListener(
          target, eventName, this.decoratePreventDefault(callback));
    }
    return <() => void>this.eventManager.addEventListener(
               target, eventName, this.decoratePreventDefault(callback)) as () => void;
  }

  private decoratePreventDefault(eventHandler: Function): Function {
    return (event: any) => {
      // Ivy uses `Function` as a special token that allows us to unwrap the function
      // so that it can be invoked programmatically by `DebugNode.triggerEventHandler`.
      if (event === Function) {
        return eventHandler;
      }

      // Run the event handler inside the ngZone because event handlers are not patched
      // by Zone on the server. This is required only for tests.
      const allowDefaultBehavior = this.ngZone.runGuarded(() => eventHandler(event));
      if (allowDefaultBehavior === false) {
        event.preventDefault();
        event.returnValue = false;
      }

      return undefined;
    };
  }
}

const AT_CHARCODE = '@'.charCodeAt(0);
function checkNoSyntheticProp(name: string, nameKind: string) {
  if (name.charCodeAt(0) === AT_CHARCODE) {
    throw new Error(`Unexpected synthetic ${nameKind} ${name} found. Please make sure that:
  - Either \`BrowserAnimationsModule\` or \`NoopAnimationsModule\` are imported in your application.
  - There is corresponding configuration for the animation named \`${
        name}\` defined in the \`animations\` field of the \`@Component\` decorator (see https://angular.io/api/core/Component#animations).`);
  }
}

function isTemplateNode(node: any): node is HTMLTemplateElement {
  return node.tagName === 'TEMPLATE' && node.content !== undefined;
}

class EmulatedEncapsulationServerRenderer2 extends DefaultServerRenderer2 {
  private contentAttr: string;
  private hostAttr: string;

  constructor(
      eventManager: EventManager, document: Document, ngZone: NgZone,
      sharedStylesHost: SharedStylesHost, schema: DomElementSchemaRegistry,
      private component: RendererType2, appId: string) {
    super(eventManager, document, ngZone, schema);

    const componentShortId = appId + '-' + this.component.id;
    const styles = shimStylesContent(componentShortId, this.component.styles);
    sharedStylesHost.addStyles(styles);

    this.contentAttr = shimContentAttribute(componentShortId);
    this.hostAttr = shimHostAttribute(componentShortId);
  }

  applyToHost(element: any) {
    super.setAttribute(element, this.hostAttr, '');
  }

  override createElement(parent: any, name: string): Element {
    const el = super.createElement(parent, name);
    super.setAttribute(el, this.contentAttr, '');
    return el;
  }
}

function _readStyleAttribute(element: any): {[name: string]: string} {
  const styleMap: {[name: string]: string} = {};
  const styleAttribute = element.getAttribute('style');
  if (styleAttribute) {
    const styleList = styleAttribute.split(/;+/g);
    for (let i = 0; i < styleList.length; i++) {
      const style = styleList[i].trim();
      if (style.length > 0) {
        const colonIndex = style.indexOf(':');
        if (colonIndex === -1) {
          throw new Error(`Invalid CSS style: ${style}`);
        }
        const name = style.slice(0, colonIndex).trim();
        styleMap[name] = style.slice(colonIndex + 1).trim();
      }
    }
  }
  return styleMap;
}

function _writeStyleAttribute(element: any, styleMap: {[name: string]: string}) {
  // We have to construct the `style` attribute ourselves, instead of going through
  // `element.style.setProperty` like the other renderers, because `setProperty` won't
  // write newer CSS properties that Domino doesn't know about like `clip-path`.
  let styleAttrValue = '';
  for (const key in styleMap) {
    const newValue = styleMap[key];
    if (newValue != null && newValue !== '') {
      styleAttrValue += key + ':' + newValue + ';';
    }
  }
  if (styleAttrValue) {
    element.setAttribute('style', styleAttrValue);
  } else {
    element.removeAttribute('style');
  }
}
