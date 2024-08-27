import kontra, { load } from 'kontra';
import { joinRoom } from 'trystero'

let { init, Sprite, SpriteSheet, keyPressed, GameLoop, initKeys, pointerPressed, onInput, initPointer, getPointer } = kontra;

let events = []
const params = new URLSearchParams(window.location.search)
let roomName = params.get("room") || "notinitialized"
console.log(roomName)
let presentMode = params.get("present") == "true" ? true : false;

const goHome = () => {
    window.open(window.location.href.split("?")[0], "_self")
    return false
}
const go = () => {
    roomName = document.getElementById('room').value
    presentMode = document.getElementById('present').checked
    console.log(presentMode)
    window.open(window.location.href.split("?")[0] + `?room=${roomName}&present=${presentMode}`, "_self")
    return false
}
let peersOnline = 0

const config = { appId: 'gifshootah' }
const room = joinRoom(config, roomName)
room.onPeerJoin(peerId => {
    peersOnline += 1;
    document.getElementById("online").textContent = `${peersOnline} peers`
})
room.onPeerLeave(peerId => {
    peersOnline -= 1;
    document.getElementById("online").textContent = `${peersOnline} peers`
})
const [shoot, getShot] = room.makeAction('shoot')


// listen for drinks sent to you
getShot((data, peerId) => {
    events.push(data)
}
)
if (!!roomName && roomName != "notinitialized") {
    document.getElementById("setting").style.display = "none";
    document.getElementById("home").style.display = "block";
    document.getElementById("home").onclick = goHome


} else {
    document.getElementById("go").onclick = go


}



// You can access specific parameters:


const spritesheets = {}

let canvas_index = 0
const canvases = []

const spritesheetUrls = [
    "/sprites/01.28.png",
    "/sprites/02.20.png",
    "/sprites/03.14.png",
    "/sprites/04.62.png"
]
let spriteUrlIndex = Math.floor(Math.random() * spritesheetUrls.length);


const loadSpritesheet = (url) => {
    var tokens = url.split('.')
    var frames = parseInt(tokens[tokens.length - 2]);
    return new Promise(function (resolve, reject) {
        if (!!spritesheets[url]) {
            return resolve(spritesheets[url])
        } else {

            let image = new Image();
            image.src = url;
            image.onload = function () {
                let spriteSheet = SpriteSheet({
                    image: image,
                    frameWidth: image.width / frames,
                    frameHeight: image.height,
                    animations: {
                        // create a named animation: walk
                        walk: {
                            frames: `0..${frames - 1}`, // frames 0 through 9
                            frameRate: 15
                        }
                    }
                });
                spritesheets[url] = spriteSheet
                return resolve(spritesheets[url])
            }
        };

    })
}
let sprites = {}

var loading = true;
const getSprite = async (sprite_id, url) => {

    if (sprites[sprite_id] && sprites[sprite_id].url == url) {
        return sprites[sprite_id]["sprite"]
    }
    let spritesheet = await loadSpritesheet(url)

    let s = Sprite({
        x: -1000,
        y: -1000,
        dx: 0,
        dy: 0,
        ddx: 0,
        ddy: 0,
        anchor: { x: 0.5, y: 0.5 },
        // use the sprite sheet animations for the sprite
        animations: spritesheet.animations
    });
    sprites[sprite_id] = { url, sprite: s }
    return s
}





if (presentMode) {

    var now = new Date() / 10.0
    let { canvas, context } = init("game");
    initPointer();
initKeys();


    context.canvas.width = window.innerWidth;
    context.canvas.height = window.innerHeight;
    for (let i = 0; i < 120; i++) {
        const offscreen = new OffscreenCanvas(canvas.width, canvas.height);
        canvases.push(offscreen)

    }
    let loop = GameLoop({ // create the main game loop
        clearCanvas: true,
        update: function () { // update the game state
            const newNow = new Date() / 10.
            if (events.length && newNow + 100 > now) {
                now = newNow + 100
                const item = events.pop()

                getSprite(item.peerId, spritesheetUrls[item.spriteUrlIndex]).then(sprite => {
                    sprite.x = item.x;
                    sprite.y = item.y
                })

            }
            if (keyPressed('enter')) {
                spriteUrlIndex = (spriteUrlIndex + 1) % spritesheetUrls.length
            }

            if (pointerPressed("left")) {
                let m = getPointer()
                const e = { spriteUrlIndex, peerId: room.selfId, x: m.x, y: m.y }
                shoot(e)
                events.push(e)


            }
            for (let key of Object.keys(sprites)) {
                let sprite = sprites[key].sprite
                sprite.update()
            }
            // wrap the sprites position when it reaches
            // the edge of the screen
            // if (sprite.x > canvas.width) {
            //     sprite.x = -sprite.width;
            // }
        },
        render: function () { // render the game state
            canvas_index++
            canvas_index = canvas_index % canvases.length
            let c = canvases[canvas_index]
            context.drawImage(
                c,
                0,
                0
            );
            for (let key of Object.keys(sprites)) {
                let sprite = sprites[key].sprite
                sprite.render()
            }
            c.getContext('2d').drawImage(
                canvas,
                0,
                0
            );
        }
    });

    loop.start(); // start the game
} else if (roomName != "notinitialized") {
    document.getElementById("phone").style.display = "block"
    let initialAlpha;
   
    let previewGif;
    let { canvasShoot, contextShoot } = init("shootbutton");
    let shootbuttoncanvas = document.getElementById("shootbutton")
    let expander = document.getElementById("expand")
    shootbuttoncanvas.width = expander.clientWidth;
    shootbuttoncanvas.height = expander.clientHeight;
    console.log(canvasShoot, contextShoot, "canvas")
    document.getElementById("nextgif").onclick = ()=>{
        spriteUrlIndex = (spriteUrlIndex + 1) % spritesheetUrls.length
    }
    document.getElementById("previousgif").onclick = ()=>{
        spriteUrlIndex = (spriteUrlIndex + spritesheetUrls.length - 1) % spritesheetUrls.length
    }
    let shootNow = false
    shootbuttoncanvas.ontouchstart = ()=>{
        shootNow = true
    }
    shootbuttoncanvas.ontouchend = ()=>{
        shootNow = false
    }
    window.addEventListener('deviceorientation', async (event) => {
        if (!initialAlpha) {
            initialAlpha = event.alpha
        }

        var b = event.beta;
        var g = event.alpha - initialAlpha
        var x = Math.sin(g / 180 * Math.PI);
        var y = Math.sin(b / 180 * Math.PI);
        if (shootNow) {
            const e = { spriteUrlIndex, peerId: room.selfId, x, y }
            console.log(e)
            shoot(e)
            navigator.vibrate(10);
        }
    })

    let previewLoop = GameLoop({ // create the main game loop
        clearCanvas: true,
        update: function () { // update the game state    
            getSprite("preview", spritesheetUrls[spriteUrlIndex]).then(sprite => {
                sprite.x = shootbuttoncanvas.width/3 + shootbuttoncanvas.width/6;
                sprite.y = shootbuttoncanvas.height/2;
                sprite.width = expander.clientWidth/2;
                sprite.height = expander.clientHeight/2;
                previewGif = sprite
                

            })
            
            if (!!previewGif) {
previewGif.update()
            }
        },
        render: function () { // render the game state

            if (!!previewGif) {
                previewGif.render()
            }
        }
    });
    previewLoop.start()

}