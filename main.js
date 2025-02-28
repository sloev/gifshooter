import kontra, { load } from 'kontra';
import { joinRoom } from 'trystero'
import QRCode from 'qrcode'
import NoSleep from 'nosleep.js';
var noSleep = new NoSleep();

let { init, Sprite, SpriteSheet, keyPressed, GameLoop, initKeys, pointerPressed, onInput, initPointer, getPointer } = kontra;

let events = []
const params = new URLSearchParams(window.location.search)
let roomName = params.get("room") || "notinitialized"
console.log(roomName)
let presentMode = params.get("present") == "true" ? true : false;
var canvas = document.getElementById('qr')

QRCode.toCanvas(canvas, window.location.href.split("?")[0] + `?room=${roomName}`, function (error) {
    if (error) console.error(error)
    console.log('success!');
})
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


import sprite_01 from './public/sprites/01.28.png'
import sprite_02 from './public/sprites/05.36.png'
import sprite_03 from './public/sprites/06.36.png'
import sprite_04 from './public/sprites/07.47.png'
import sprite_05 from './public/sprites/08.39.png'
import sprite_06 from './public/sprites/09.41.png'
import sprite_07 from './public/sprites/10.39.png'
import sprite_08 from './public/sprites/11.39.png'
import sprite_09 from './public/sprites/12.20.png'
import sprite_10 from './public/sprites/13.20.png'
import sprite_11 from './public/sprites/14.20.png'
import sprite_12 from './public/sprites/15.72.png'
import sprite_13 from './public/sprites/16.12.png'
import sprite_14 from './public/sprites/17.36.png'
import sprite_15 from './public/sprites/18.27.png'
import sprite_16 from './public/sprites/19.65.png'
import sprite_17 from './public/sprites/20.28.png'
import sprite_18 from './public/sprites/21.113.png'
import sprite_19 from './public/sprites/22.45.png'
import sprite_20 from './public/sprites/23.11.png'
import sprite_21 from './public/sprites/24.125.png'
import sprite_22 from './public/sprites/25.120.png'
import sprite_23 from './public/sprites/26.73.png'
import sprite_24 from './public/sprites/27.121.png'
import sprite_25 from './public/sprites/28.31.png'
import sprite_26 from './public/sprites/29.123.png'
import sprite_27 from './public/sprites/30.29.png'
import sprite_28 from './public/sprites/31.90.png'
import sprite_29 from './public/sprites/32.147.png'
import sprite_30 from './public/sprites/32.17.png'




import logo from './public/logo.gif'

document.getElementById("logo").src = logo

const spritesheetUrls = [
    sprite_01,
    sprite_02,
    sprite_03,
    sprite_04,
    sprite_05,
    sprite_06,
    sprite_07,
    sprite_08,
    sprite_09,
    sprite_10,
    sprite_11,
    sprite_12,
    sprite_13,
    sprite_14,
    sprite_15,
    sprite_16,
    sprite_17,
    sprite_18,
    sprite_19,
    sprite_20,
    sprite_21,
    sprite_22,
    sprite_23,
    sprite_24,
    sprite_25,
    sprite_26,
    sprite_27,
    sprite_28,
    sprite_29,
    sprite_30
]
let spriteUrlIndex = Object.keys(room.getPeers()).length % spritesheetUrls.length;


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
    let qr = document.getElementById("qr")
    qr.style.display = "block"

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    for (let i = 0; i < 120; i++) {
        const offscreen = new OffscreenCanvas(canvas.width, canvas.height);
        canvases.push(offscreen)

    }
    let fader = 0
    let loop = GameLoop({ // create the main game loop
        clearCanvas: true,
        update: function () { // update the game state
            const newNow = new Date() / 10.
            if (events.length) {// && newNow + 100 > now) {
                now = newNow + 100
                const item = events[0]
                events = events.slice(1)
                fader = spritesheetUrls.length


                getSprite(item.peerId, spritesheetUrls[item.spriteUrlIndex]).then(sprite => {
                    console.log("raw", item)
                    sprite.x = (item.x * -1.0) * context.canvas.width + context.canvas.width / 2;
                    sprite.y = (item.y * -1.0) * context.canvas.height + context.canvas.height / 2;
                    console.log(sprite.x, sprite.y)
                })

            }
            if (keyPressed('enter')) {
                spriteUrlIndex = (spriteUrlIndex + 1) % spritesheetUrls.length
            }

            if (pointerPressed("left")) {
                let m = getPointer()
                const e = { spriteUrlIndex, peerId: room.selfId, x: m.x / context.canvas.width, y: m.ycontext.canvas.height }
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
            if (fader > 0) {
                let ctx = c.getContext('2d')
                ctx.globalAlpha = 0.01;
                ctx.fillRect(0, 0, c.width, c.height);
                ctx.globalAlpha = 1.0;
                fader-=1
            }


            context.drawImage(
                c,
                0,
                0);

            for (let key of Object.keys(sprites)) {
                let sprite = sprites[key].sprite
                sprite.render()
            }

            c.getContext('2d').drawImage(
                canvas,
                0, 0
            );
        }
    });

    loop.start(); // start the game
} else if (roomName != "notinitialized") {
    document.getElementById("phone").style.display = "block"
    let initialAlpha, initialBeta;
    document.getElementById("reset").onclick = () => {
        initialAlpha = null
        initialBeta = null
    }

    let previewGif;
    let { canvasShoot, contextShoot } = init("shootbutton");
    let shootbuttoncanvas = document.getElementById("shootbutton")
    let expander = document.getElementById("expand")

    shootbuttoncanvas.width = expander.clientWidth;
    shootbuttoncanvas.height = expander.clientHeight;
    console.log(canvasShoot, contextShoot, "canvas")

    document.getElementById("nextgif").onclick = () => {
        spriteUrlIndex = (spriteUrlIndex + 1) % spritesheetUrls.length
    }
    document.getElementById("previousgif").onclick = () => {
        spriteUrlIndex = (spriteUrlIndex + spritesheetUrls.length - 1) % spritesheetUrls.length
    }
    let shootNow = false
    shootbuttoncanvas.ontouchstart = () => {
        noSleep.enable();

        shootNow = true
    }
    shootbuttoncanvas.ontouchend = () => {
        shootNow = false
    }
    window.addEventListener('deviceorientation', async (event) => {
        if (!initialAlpha) {
            initialAlpha = event.alpha
            initialBeta = event.beta
        }
        var x = event.alpha - initialAlpha;  // In degree in the range [-180,180]
        var y = event.beta - initialBeta; // In degree in the range [-90,90]
        if (x < -180) x = -180
        if (x > 180) x = 180
        if (y < -90) y = -90
        if (y > 90) y = 90
        x = x / 180.0
        y = y / 90

        if (shootNow) {
            const e = { spriteUrlIndex, peerId: room.selfId, x: x, alpha: event.alpha, y: y, beta: event.beta }
            console.log(e)
            shoot(e)
        }
    })

    let previewLoop = GameLoop({ // create the main game loop
        clearCanvas: true,
        update: function () { // update the game state    
            getSprite("preview", spritesheetUrls[spriteUrlIndex]).then(sprite => {
                sprite.x = shootbuttoncanvas.width / 3 + shootbuttoncanvas.width / 6;
                sprite.y = shootbuttoncanvas.height / 2;
                sprite.width = expander.clientWidth / 2;
                sprite.height = expander.clientHeight / 2;
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