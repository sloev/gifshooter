import { Color, Rapid } from "rapid-render"


let rapid = new Rapid({
    canvas: document.getElementById("game"),
    backgroundColor: Color.fromHex("FFFF00")
})
console.log(document.getElementById("game"))
const textures = {}
const loadSprite = async(url, frames) => {
    textures[url] = []

    for (var i = 0; i < frames; i++) {
        const tex = await rapid.texture.textureFromUrl(url)
        console.log(tex)
        tex.setClipRegion(
            i * tex.width / frames, 0, // top-left corner of the clipped region.
            tex.width / frames, tex.height // size
        )
        textures[url].push(tex)
    }



}
await loadSprite("/sprites/01.29.png", 29)

console.log(textures)
const sprites = []

class Sprite {
    constructor(texture_id) {
        this.x = 100 * Math.random()
        this.y = 100 * Math.random()
        this.texture_id = texture_id
        this.texture_index = 0
    }
}
const addSprite = () => {
    sprites.push(new Sprite("/sprites/01.29.png"))
    console.log("added sprite")
}

for (var index = 0; index < 10; index++) {
    addSprite()
}
let add = false
let time = 0
rapid.canvas.onmousedown = () => {
    add = true
}
rapid.canvas.onmouseup = () => {
    add = false
}

const render = () => {
    if (add) {
        for (let index = 0; index < 50; index++) {
            addSprite()
        }
    }
    time += 0.01
    rapid.startRender()

    for (let index = 0; index < sprites.length; index++) {
        const element = sprites[index];

        rapid.save()

        rapid.matrixStack.translate(element.x, element.y)
        element.texture_index = (element.texture_index + 1) % textures[element.texture_id].length
        rapid.renderSprite(textures[element.texture_id][element.texture_index])
        rapid.restore()
    }
    rapid.endRender()
}

function animate() {
    render()
    requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
const color = Color.fromHex("FFFF00")
rapid.startGraphicDraw()
rapid.addGraphicVertex(0, 0, color)
rapid.addGraphicVertex(100, 0, color)
rapid.addGraphicVertex(100, 100, color)
rapid.endGraphicDraw()

// Called after rendering
rapid.endRender()
rapid.resize(100, 100)