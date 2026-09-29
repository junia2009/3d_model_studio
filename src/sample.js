import { FORMAT, FORMAT_VERSION } from './serializer.js';

const mat = (color, extra = {}) => ({ color, metalness: 0.1, roughness: 0.5, opacity: 1, wireframe: false, flatShading: false, ...extra });
const deg = (d) => (d * Math.PI) / 180;

const part = (name, type, params, position, material, { rotation = [0, 0, 0], scale = [1, 1, 1] } = {}) => ({
  kind: 'primitive',
  name,
  type,
  params,
  position,
  rotation,
  scale,
  material,
});

const group = (name, position, children) => ({
  kind: 'group',
  name,
  position,
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  children,
});

/** 部品を組み合わせたサンプル：ロボットと木 */
export function sampleScene() {
  const metal = mat('#9aa0aa', { metalness: 0.7, roughness: 0.3 });
  const blue = mat('#4f8cff', { metalness: 0.3, roughness: 0.4 });
  const dark = mat('#2b2f38');
  const glow = mat('#ffd43b', { roughness: 0.2 });

  const robot = group('ロボット', [-0.9, 0, 0], [
    part('胴体', 'box', { width: 1, height: 1.1, depth: 0.7 }, [0, 1.25, 0], blue),
    part('胸のパネル', 'box', { width: 0.5, height: 0.35, depth: 0.05 }, [0, 1.35, 0.36], dark),
    part('ボタン', 'sphere', { radius: 0.05, segments: 16 }, [0.12, 1.35, 0.4], glow),
    part('首', 'cylinder', { radiusTop: 0.12, radiusBottom: 0.15, height: 0.15, segments: 24 }, [0, 1.87, 0], metal),
    group('頭', [0, 1.95, 0], [
      part('頭', 'box', { width: 0.75, height: 0.55, depth: 0.6 }, [0, 0.28, 0], metal),
      part('右目', 'sphere', { radius: 0.08, segments: 24 }, [-0.17, 0.33, 0.29], glow),
      part('左目', 'sphere', { radius: 0.08, segments: 24 }, [0.17, 0.33, 0.29], glow),
      part('口', 'box', { width: 0.3, height: 0.05, depth: 0.05 }, [0, 0.14, 0.3], dark),
      part('アンテナ', 'cylinder', { radiusTop: 0.02, radiusBottom: 0.02, height: 0.3, segments: 12 }, [0, 0.7, 0], dark),
      part('アンテナの玉', 'sphere', { radius: 0.07, segments: 16 }, [0, 0.87, 0], mat('#ff5d5d')),
    ]),
    part('右腕', 'capsule', { radius: 0.12, length: 0.6 }, [-0.66, 1.3, 0], metal, { rotation: [0, 0, deg(-12)] }),
    part('左腕', 'capsule', { radius: 0.12, length: 0.6 }, [0.66, 1.3, 0], metal, { rotation: [0, 0, deg(12)] }),
    part('右脚', 'cylinder', { radiusTop: 0.15, radiusBottom: 0.15, height: 0.6, segments: 24 }, [-0.25, 0.4, 0], dark),
    part('左脚', 'cylinder', { radiusTop: 0.15, radiusBottom: 0.15, height: 0.6, segments: 24 }, [0.25, 0.4, 0], dark),
    part('右足', 'box', { width: 0.3, height: 0.1, depth: 0.45 }, [-0.25, 0.05, 0.06], blue),
    part('左足', 'box', { width: 0.3, height: 0.1, depth: 0.45 }, [0.25, 0.05, 0.06], blue),
  ]);

  const leaf = mat('#51cf66', { flatShading: true, roughness: 0.8 });
  const tree = group('木', [1.4, 0, -0.3], [
    part('幹', 'cylinder', { radiusTop: 0.12, radiusBottom: 0.18, height: 0.9, segments: 12 }, [0, 0.45, 0], mat('#7a4b2a', { roughness: 0.9 })),
    part('葉 下', 'cone', { radius: 0.75, height: 0.9, segments: 8 }, [0, 1.2, 0], leaf),
    part('葉 中', 'cone', { radius: 0.6, height: 0.8, segments: 8 }, [0, 1.65, 0], leaf),
    part('葉 上', 'cone', { radius: 0.42, height: 0.7, segments: 8 }, [0, 2.05, 0], leaf),
  ]);

  const rock = part('岩', 'icosahedron', { radius: 0.35, detail: 0 }, [0.6, 0.22, 0.8], mat('#9aa0aa', { flatShading: true, roughness: 0.9 }), {
    rotation: [deg(20), deg(35), 0],
    scale: [1.2, 0.7, 1],
  });

  return { format: FORMAT, version: FORMAT_VERSION, objects: [robot, tree, rock] };
}
