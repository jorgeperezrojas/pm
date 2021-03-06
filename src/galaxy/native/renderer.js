/**
 * This is a bridge between ultrafast particle renderer and react world.
 *
 * It listens to graph loading events. Once graph positions are loaded it calls
 * native renderer to show the positions.
 *
 * It also listens to native renderer for user interaction. When user hovers
 * over a node or clicks on it - it reports user actions back to the global
 * events bus. These events are later consumed by stores to show appropriate
 * UI feedback
 */
// TODO: This class needs to be refactored. It is doing too much, and parts
// of its code should be done from unrender itself
// TODO: Use DynamicBufferAttribute which can accelarate render
// E.g.: threejs.org/examples/webgl_buffergeometry_drawcalls.html
import unrender from 'unrender';
window.THREE = unrender.THREE;

import eventify from 'ngraph.events';
import appEvents from '../service/appEvents.js';
import scene from '../store/scene.js';
import getNearestIndex from './getNearestIndex.js';
import createTouchControl from './touchControl.js';
import createLineView from './lineView.js';
import appConfig from './appConfig.js';

export default sceneRenderer;

var defaultNodeColor = 0xffffffff;

var highlightNodeColor = 0xff0000ff;

function sceneRenderer(container) {
  var renderer, positions, graphModel, touchControl;
  var hitTest, lastHighlight, lastHighlightSize, cameraPosition;
  var lineView, links, lineViewNeedsUpdate;
  var queryUpdateId = setInterval(updateQuery, 200);

  // RENDER LABELS
  var labelsList;
  var labelsElements = [];
  appEvents.clusterLabelsDownloaded.on(setClusterLabels);
  // RENDER LABELS

  appEvents.positionsDownloaded.on(setPositions);
  appEvents.linksDownloaded.on(setLinks);
  appEvents.toggleSteering.on(toggleSteering);
  appEvents.focusOnNode.on(focusOnNode);
  appEvents.around.on(around);
  appEvents.highlightQuery.on(highlightQuery);
  appEvents.highlightLinks.on(highlightLinks);
  appEvents.accelerateNavigation.on(accelarate);
  appEvents.focusScene.on(focusScene);
  appEvents.cls.on(cls);

  appConfig.on('camera', moveCamera);
  appConfig.on('showLinks', toggleLinks);
  appConfig.on('showLabels', toggleLabels); // TEST RENDER

  var api = {
    destroy: destroy
  };

  eventify(api);

  return api;

  // RENDER LABELS
  function setClusterLabels(data) {
    labelsList = data;
    
    // Crea los elementos de texto a renderizar. Asigna los datos de posición al elemento.
    // La comunicación con el renderizado en Three.js es a partir del nombre de la clase 
    // de los elementos (MUY HORRIBLE, lo se)
    for (var i = 0; i < labelsList.length; ++i) {
      var div = document.createElement('div');
      div.classList.add('labels-div-element');
      div.innerHTML = labelsList[i].label;
      div.dataset.x = labelsList[i].x;
      div.dataset.y = labelsList[i].y;
      div.dataset.z = labelsList[i].z;
      div.dataset.label = labelsList[i].label;
      container.appendChild(div);
      labelsElements[i] = div;
    }
  }
  // RENDER LABELS

  function accelarate(isPrecise) {
    var input = renderer.input();
    if (isPrecise) {
      input.movementSpeed *= 4;
      input.rollSpeed *= 4;
    } else {
      input.movementSpeed /= 4;
      input.rollSpeed /= 4;
    }
  }

  function updateQuery() {
    if (!renderer) return;
    var camera = renderer.camera();

    appConfig.setCameraConfig(camera.position, camera.quaternion);

  }

  function toggleSteering() {
    if (!renderer) return;

    var input = renderer.input();
    var isDragToLookEnabled = input.toggleDragToLook();

    // steering does not require "drag":
    var isSteering = !isDragToLookEnabled;
    appEvents.showSteeringMode.fire(isSteering);
  }

  function clearHover() {
    appEvents.nodeHover.fire({
      nodeIndex: undefined,
      mouseInfo: undefined
    });
  }

  function focusOnNode(nodeId) {
    if (!renderer) return;

    renderer.lookAt(nodeId * 3, highlightFocused);

    function highlightFocused() {
      appEvents.selectNode.fire(nodeId);
    }
  }

  function around(r, x, y, z) {
    renderer.around(r, x, y, z);
  }

  function setPositions(_positions) {
    destroyHitTest();

    positions = _positions;
    focusScene();

    if (!renderer) {
      renderer = unrender(container);
      touchControl = createTouchControl(renderer);
      moveCameraInternal();
      var input = renderer.input();
      input.on('move', clearHover);
    }

    renderer.particles(positions);

    hitTest = renderer.hitTest();
    hitTest.on('over', handleOver);
    hitTest.on('click', handleClick);
    hitTest.on('dblclick', handleDblClick);
    hitTest.on('hitTestReady', adjustMovementSpeed);



  }

  function adjustMovementSpeed(tree) {
    var input = renderer.input();
    if (tree) {
      var root = tree.getRoot();
      input.movementSpeed = root.bounds.half * 0.02;
    } else {
      input.movementSpeed *= 2;
    }
  }

  function focusScene() {
    // need to be within timeout, in case if we are detached (e.g.
    // first load)
    setTimeout(function() {
      container.focus();
    }, 30);
  }

  function setLinks(outLinks, inLinks) {
    links = outLinks;
    lineViewNeedsUpdate = true;
    updateSizes(outLinks, inLinks);
    renderLineViewIfNeeded();
  }

  function updateSizes(outLinks, inLinks) { // CAMBIAR TAMAÑO NODOS (TODOS 30)
    var maxInDegree = getMaxSize(inLinks);
    var view = renderer.getParticleView();
    var sizes = view.sizes();
    for (var i = 0; i < sizes.length; ++i) {
    // /*** ESTO LO COMENTÉ  PARA QUE TODOS LOS NODOS TUVIERAN EL MISMO TAMAÑO ***/
    //   var degree = inLinks[i];
    //   if (degree) {
    //     sizes[i] = ((200 / maxInDegree) * degree.length + 15);
    //   } else {
    //     sizes[i] = 30;
    //   }
      sizes[i] = 30; // CAMBIAR TAMAÑO NODOS (TODOS 30)
    }
    
    view.sizes(sizes);

  }

  function getMaxSize(sparseArray) {
    var maxSize = 0;
    for (var i = 0; i < sparseArray.length; ++i) {
      var item = sparseArray[i];
      if (item && item.length > maxSize) maxSize = item.length;
    }

    return maxSize;
  }

  function renderLineViewIfNeeded() {
    if (!appConfig.getShowLinks()) return;
    if (!lineView) {
      lineView = createLineView(renderer.scene(), unrender.THREE);
    }
    lineView.render(links, positions);
    lineViewNeedsUpdate = false;
  }

  function toggleLinks() {
    if (lineView) {
      if (lineViewNeedsUpdate) renderLineViewIfNeeded();
      lineView.toggleLinks();
    } else {
      renderLineViewIfNeeded();
    }

  }

  // RENDER LABELS
  function toggleLabels() {
    // ESTO NO DEBERÍA HACERLO ASI NI AQUÍ
    if (appConfig.getShowLabels()) {
      for(var i = 0; i < labelsElements.length; ++i) {
          labelsElements[i].style.visibility = 'visible';
      }
    }
    else {
      for(var i = 0; i < labelsElements.length; ++i) {
          labelsElements[i].style.visibility = 'hidden';
      }
    }
    return;
  }
  // RENDER LABELS

  function moveCamera() {
    moveCameraInternal();
  }

  function moveCameraInternal() {
    if (!renderer) return;

    var camera = renderer.camera();
    var pos = appConfig.getCameraPosition();
    if (pos) {
      camera.position.set(pos.x, pos.y, pos.z);
    }
    var lookAt = appConfig.getCameraLookAt();
    if (lookAt) {
      camera.quaternion.set(lookAt.x, lookAt.y, lookAt.z, lookAt.w);
    }

    // RENDER LABELS
    // ESTO NO DEBERIA HACERLO EN ESTE MÉTODO!!!
    // Pone los labels inicialmente en posición
    if (!labelsElements) return;

    for (var i = 0; i < labelsElements.length; ++i) {
      var labelElement = labelsElements[i];
      var x = labelElement.dataset.x;
      var y = labelElement.dataset.y;
      var z = labelElement.dataset.z;
      var position = new window.THREE.Vector3(x,y,z)
      var proj = position.project(camera);
      var left = (proj.x + 1)/2 * window.innerWidth;
      var top = (-proj.y + 1)/2 * window.innerHeight;

      // actualiza posiciones solo si están en el rango visible (ventana), con cierto margen
      // de otra forma déjalas estáticas fuera del rango
      if (proj.z < 1 && left >= -500 && top >= -50 && left <= window.innerWidth + 500 && top <= window.innerHeight + 50) { 
        labelElement.style.left = left + 'px';
        labelElement.style.top =  top + 'px'; 

        // cambia propiedades del font, z-index y opacidad a partir de la distancia a la cámara
        var distancia = position.distanceTo(pos)/1000;
        var sizeFactor = Math.round(distancia*10)/10;
        labelElement.style.fontSize = 20 - sizeFactor + 'px';
        labelElement.style.zIndex = Math.round(20 - sizeFactor);
        labelElement.style.opacity = 1 - Math.pow((sizeFactor - 7)/10,2);
      }
      else {
        labelElement.style.left = '-500px';
        labelElement.style.top =  '-500px';         
      }
    }
    // RENDER LABELS

  }

  function destroyHitTest() {
    if (!hitTest) return; // nothing to destroy

    hitTest.off('over', handleOver);
    hitTest.off('click', handleClick);
    hitTest.off('dblclick', handleDblClick);
    hitTest.off('hitTestReady', adjustMovementSpeed);
  }

  function handleClick(e) {
    var nearestIndex = getNearestIndex(positions, e.indexes, e.ray, 30);

    appEvents.selectNode.fire(getModelIndex(nearestIndex));
  }

  function handleDblClick(e) {
    var nearestIndex = getNearestIndex(positions, e.indexes, e.ray, 30);
    if (nearestIndex !== undefined) {
      focusOnNode(nearestIndex/3);
    }
  }

  function handleOver(e) {
    var nearestIndex = getNearestIndex(positions, e.indexes, e.ray, 30);

    highlightNode(nearestIndex);
    appEvents.nodeHover.fire({
      nodeIndex: getModelIndex(nearestIndex),
      mouseInfo: e
    });
  }

  function highlightNode(nodeIndex) {
    var view = renderer.getParticleView();
    var colors = view.colors();
    var sizes = view.sizes();

    if (lastHighlight !== undefined) {
      colorNode(lastHighlight, colors, defaultNodeColor);
      sizes[lastHighlight/3] = lastHighlightSize;
    }

    lastHighlight = nodeIndex;

    if (lastHighlight !== undefined) {
      colorNode(lastHighlight, colors, highlightNodeColor);
      lastHighlightSize = sizes[lastHighlight/3];
      sizes[lastHighlight/3] *= 1.5;
    }

    view.colors(colors);
    view.sizes(sizes);
  }

  function highlightQuery(query, color, scale) {
    if (!renderer) return;

    var nodeIds = query.results.map(toNativeIndex);
    var view = renderer.getParticleView();
    var colors = view.colors();

    for (var i = 0; i < nodeIds.length; ++i) {
      colorNode(nodeIds[i], colors, color)
    }

    view.colors(colors);
    appEvents.queryHighlighted.fire(query, color);
  }

  function colorNode(nodeId, colors, color) {
    var colorOffset = (nodeId/3) * 4;
    colors[colorOffset + 0] = (color >> 24) & 0xff;
    colors[colorOffset + 1] = (color >> 16) & 0xff;
    colors[colorOffset + 2] = (color >> 8) & 0xff;
    colors[colorOffset + 3] = (color & 0xff);
  }

  function highlightLinks(links, color) {
    var lines = new Float32Array(links.length * 3);
    for (var i = 0; i < links.length; ++i) {
      var i3 = links[i] * 3;
      lines[i * 3] = positions[i3];
      lines[i * 3 + 1] = positions[i3 + 1];
      lines[i * 3 + 2] = positions[i3 + 2];
    }
    renderer.lines(lines, color);
  }

  function cls() {
    var view = renderer.getParticleView();
    var colors = view.colors();

    for (var i = 0; i < colors.length/4; i++) {
      colorNode(i * 3, colors, 0xffffffff);
    }

    view.colors(colors);
  }

  function toNativeIndex(i) {
    return i.id * 3;
  }

  function getModelIndex(nearestIndex) {
    if (nearestIndex !== undefined) {
      // since each node represented as triplet we need to divide by 3 to
      // get actual index:
      return nearestIndex/3
    }
  }

  function destroy() {
    var input = renderer.input();
    if (input) input.off('move', clearHover);
    renderer.destroy();
    appEvents.positionsDownloaded.off(setPositions);
    appEvents.linksDownloaded.off(setLinks);

    if (touchControl) touchControl.destroy();
    renderer = null;

    clearInterval(queryUpdateId);
    appConfig.off('camera', moveCamera);
    appConfig.off('showLinks', toggleLinks);

    appConfig.off('showLabels', toggleLabels); // RENDER LABELS

    // todo: app events?
  }

}
