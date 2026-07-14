//Load overlay
fetch(chrome.runtime.getURL("overlay.html"))
    .then(response => response.text())
    .then(html => {
        document.body.insertAdjacentHTML("beforeend", html);
    });

var audioOpened = false;
var payClicked = false;
var itemAdded = false;
var blockImageCreated = false;

// image that will cover what send is selected
const blockImage = "https://i.imgur.com/c4RK5sR.png";

const imageURLs = [ 
  "https://i.imgur.com/7URcmDI.jpg",
  "https://i.imgur.com/JYGNapv.jpg",
  "https://i.imgur.com/HiMGDP0.jpg",
  "https://i.imgur.com/a5eCZzF.jpg",
  "https://i.imgur.com/QUs2xyx.jpg",
  "https://i.imgur.com/9s6Zs4N.jpg",
  "https://i.imgur.com/p8UNdWs.jpg",
  "https://i.imgur.com/uyPlpCu.jpg",
  "https://i.imgur.com/8POcSXF.jpg",
  "https://i.imgur.com/rRjM0sM.jpg",
  "https://i.imgur.com/qnVKEva.jpg",
  "https://i.imgur.com/4qzU7B1.jpg",
  "https://i.imgur.com/5FPPFWJ.jpg",
  "https://i.imgur.com/ynmppMp.jpg",
  "https://i.imgur.com/WccbrY7.jpg",
  "https://i.imgur.com/qe8gqT0.jpg",
  "https://i.imgur.com/ENGbRyZ.jpg",
  "https://i.imgur.com/8GggwbA.jpg",
  "https://i.imgur.com/pfaQMS0.jpg",
  "https://i.imgur.com/abWzF52.jpg",
  "https://i.imgur.com/ZSqbtBy.jpg",
  "https://i.imgur.com/8Xipqtk.jpg",
  "https://i.imgur.com/oALyMqI.jpg",
  "https://i.imgur.com/GOb4Suz.jpg",
  "https://i.imgur.com/7q3YFh6.jpg",
  "https://i.imgur.com/FUTucUD.jpg",
  "https://i.imgur.com/88cNZNx.jpg",
  "https://i.imgur.com/ryLTL0l.jpg",
  "https://i.imgur.com/Gs744DH.jpg",
  "https://i.imgur.com/30M4GD1.jpg",
"https://i.imgur.com/Q1v0k1r.jpg",
"https://i.imgur.com/Ums1Mhp.jpg",
"https://i.imgur.com/DTItF8P.jpg",
"https://i.imgur.com/Z4wua8k.jpg",
"https://i.imgur.com/k8IT3xD.jpg",
"https://i.imgur.com/Wa8ZrHm.jpg",
"https://i.imgur.com/IzatODd.jpg",
"https://i.imgur.com/SSMjUcE.jpg",
"https://i.imgur.com/T6Ofy2H.jpg",
"https://i.imgur.com/VgSTeh1.jpg",
"https://i.imgur.com/lfqkM2H.jpg",
"https://i.imgur.com/ilFZsko.jpg",
"https://i.imgur.com/lu82gA6.jpg",
"https://i.imgur.com/gH4VgXL.jpg",
"https://i.imgur.com/6HTlLH0.jpg",
"https://i.imgur.com/pOCxaOW.jpg",
"https://i.imgur.com/96wRqPW.jpg",

  "https://i.imgur.com/VQ2jcGF.jpg"
];
  
const style = document.createElement('style');
style.textContent = `
  .popup-image {
    border-color: rgb(255, 117, 237);
    box-shadow: 0 0 10px rgb(255, 117, 237), 0 0 20px rgb(255, 117, 237), 0 0 30px rgb(255, 117, 237);
    max-width: 450px; /* or whatever you want */
    min-width: 150px;
    height: auto; /* maintains aspect ratio */
  }

  .popup-image:hover {
    border-color:rgb(163, 15, 163);
    box-shadow: 0 0 10px rgb(163, 15, 163), 0 0 20px rgb(163, 15, 163), 0 0 30px rgb(163, 15, 163);
  }
`;

document.head.appendChild(style);
const christmasItems = [
  "pathetic snack~", "coffee", "milk snack~", "spit drink~", "cute meal~",
  "swipe meal~", "hot meal~", "soul buffet~"
];

const itemWeights = {
  "pathetic snack~": 225,
  "coffee": 225,
  "milk snack~": 225,
  "spit drink~": 225,
  "cute meal~": 32,
  "swipe meal~": 32,
  "hot meal~": 16,
  "soul buffet~": 6
};

const group8pct = ["cute meal~", "swipe meal~", "hot meal~"];

let randomItemChosen = null;

function loadPityCounters() {
  try {
    return {
      pullsSince8pct: parseInt(localStorage.getItem('alexia_pullsSince8pct') || '0'),
      pullsSinceSoulReap: parseInt(localStorage.getItem('alexia_pullsSinceSoulReap') || '0')
    };
  } catch (e) {
    return { pullsSince8pct: 0, pullsSinceSoulReap: 0 };
  }
}

function savePityCounters(pullsSince8pct, pullsSinceSoulReap) {
  try {
    localStorage.setItem('alexia_pullsSince8pct', String(pullsSince8pct));
    localStorage.setItem('alexia_pullsSinceSoulReap', String(pullsSinceSoulReap));
  } catch (e) {}
  chrome.runtime.sendMessage({ action: 'updatePity', pullsSince8pct, pullsSinceSoulReap });
}

function chooseOneRandomItem() {
  if (!randomItemChosen) {
    let { pullsSince8pct, pullsSinceSoulReap } = loadPityCounters();

    if (pullsSinceSoulReap >= 79) {
      // 80-pull soul buffet pity
      randomItemChosen = "soul buffet~";
      console.log(`PITY: Soul buffet guaranteed after ${pullsSinceSoulReap + 1} pulls!`);
    } else if (pullsSince8pct >= 9) {
      // 10-pull 8% group pity — pick from cute/swipe/hot using their relative weights
      let roll = Math.random() * 80; // 32 + 32 + 16
      for (const item of group8pct) {
        roll -= itemWeights[item] || 0;
        if (roll <= 0) { randomItemChosen = item; break; }
      }
      if (!randomItemChosen) randomItemChosen = group8pct[0];
      console.log(`PITY: 8% group guaranteed after ${pullsSince8pct + 1} pulls! Got: "${randomItemChosen}"`);
    } else {
      // Normal weighted random
      const totalWeight = christmasItems.reduce(
        (sum, item) => sum + (itemWeights[item] || 0),
        0
      );
      let roll = Math.random() * totalWeight;
      for (const item of christmasItems) {
        roll -= itemWeights[item] || 0;
        if (roll <= 0) {
          randomItemChosen = item;
          break;
        }
      }
    }

    // Update pity counters
    if (randomItemChosen === "soul buffet~") {
      pullsSinceSoulReap = 0;
      pullsSince8pct = 0;
    } else if (group8pct.includes(randomItemChosen)) {
      pullsSince8pct = 0;
      pullsSinceSoulReap++;
    } else {
      pullsSince8pct++;
      pullsSinceSoulReap++;
    }

    savePityCounters(pullsSince8pct, pullsSinceSoulReap);
    console.log(`Alexia has chosen: "${randomItemChosen}" | Until 8% pity: ${Math.max(0, 10 - pullsSince8pct)} | Until soul reap pity: ${Math.max(0, 80 - pullsSinceSoulReap)}`);
  }

  return randomItemChosen;
}

function addExactlyOneItem() {
  if (itemAdded) return;  

  setTimeout(() => {
    if (itemAdded) return;

    const target = chooseOneRandomItem();
    const cards = document.querySelectorAll("[class*=chakra-stack]");

    for (const card of cards) {
      const label = card.querySelector("p");
      if (label && label.textContent.trim().toLowerCase().includes(target)) {
        const btn = card.querySelector("button");
        if (btn && btn.textContent.toLowerCase().includes("add")) {
          console.log(`Adding ONE "${target}"`);
          btn.click();
          itemAdded = true;  
          randomItemChosen = null; 
        }
      }
    }

    clickCheckoutIfExists();
  }, 6000);
}

function clickCheckoutIfExists() {
  setTimeout(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      if (btn.textContent.trim().toLowerCase() === "checkout") {
        console.log("Clicking Checkout...");
        btn.click();
        return;
      }
    }
  }, 6000);
}

function clickPayNowIfExists() {
  setTimeout(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const span = btn.querySelector("span");
      if (span && span.textContent.trim().toLowerCase() === "pay now" && !btn.disabled) {
        console.log("Clicking Pay Now...");
        chrome.runtime.sendMessage({ action: 'pullComplete' });
        btn.click();
        payClicked = true;
        itemAdded = false;
        return;
      }
    }
  }, 5000);
}

function spawnImage() {
  const imageElement = createImage("fixed", "10000");
  imageElement.style.left = Math.random() * (window.innerWidth - 450) + "px";
  imageElement.style.top = Math.random() * (window.innerHeight - 600) + "px";
  document.body.appendChild(imageElement);

  //img to block what send is selected
  if (!blockImageCreated) { 
    const costBlockElement = createImage("absolute", "10001", blockImage);
    costBlockElement.style.left = window.innerWidth - 475 + "px";
    costBlockElement.style.top = 75 + "px";
    document.body.appendChild(costBlockElement);
    blockImageCreated = true;
  }

  setTimeout(() => imageElement.remove(), 10000);
}

function createImage(positionType, index, imgSrc = imageURLs[Math.floor(Math.random() * imageURLs.length)]) {
  const randomImage = imgSrc;
  const tempImage = document.createElement('img');
  tempImage.src = randomImage;
  tempImage.className = "popup-image";
  tempImage.style.position = positionType;
  tempImage.style.zIndex = index;

  return tempImage;
}

let imageInterval = null;

function startImageSpawning() {
  if (!imageInterval) {
    imageInterval = setInterval(spawnImage, 1000);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'doPull') {
    startImageSpawning();
    setTimeout(() => addExactlyOneItem(), 2000);
    sendResponse({ ok: true });
  }
  if (msg.action === 'doPayment') {
    startImageSpawning();
    clickPayNowIfExists();    // pays and signals pullComplete to background
    sendResponse({ ok: true });
  }
  return true;
});