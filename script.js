const canvas = document.getElementById('waveCanvas');
const ctx = canvas.getContext('2d');
const speedSlider = document.getElementById('speedSlider');
const speedDisplay = document.getElementById('speedDisplay');

let width, height;
let time = 0;
let transitionSpeed = parseFloat(speedSlider.value);

// Base parameters and their targets for automatic shifting
let freq1 = 0.02, targetFreq1 = 0.02;
let freq2 = 0.01, targetFreq2 = 0.01;
let amp1 = 40, targetAmp1 = 40;
let amp2 = 20, targetAmp2 = 20;

function initCanvas() {
    width = canvas.width = canvas.parentElement.clientWidth;
    height = canvas.height = canvas.parentElement.clientHeight;
}

// Handle window resize to keep canvas responsive
window.addEventListener('resize', initCanvas);
initCanvas();

// Update speed dynamically based on user input
speedSlider.addEventListener('input', (e) => {
    transitionSpeed = parseFloat(e.target.value);
    speedDisplay.textContent = transitionSpeed.toFixed(2);
});

function calculateTransitions() {
    // Randomly assign new mathematical targets to create fluid, automatic transitions
    if (Math.random() < 0.015) {
        targetFreq1 = 0.01 + Math.random() * 0.05;
        targetFreq2 = 0.005 + Math.random() * 0.03;
        targetAmp1 = 20 + Math.random() * 60;
        targetAmp2 = 10 + Math.random() * 40;
    }

    // Linear interpolation (lerp) for smooth parameter adjustments
    freq1 += (targetFreq1 - freq1) * 0.02;
    freq2 += (targetFreq2 - freq2) * 0.02;
    amp1 += (targetAmp1 - amp1) * 0.02;
    amp2 += (targetAmp2 - amp2) * 0.02;
}

function drawWave() {
    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    ctx.strokeStyle = '#ff1493'; // Deep pink waveform styling
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';

    for (let x = 0; x < width; x++) {
        // Generate a complex wave by combining sine and cosine functions
        const y = height / 2
            + Math.sin(x * freq1 + time) * amp1
            + Math.cos(x * freq2 - time * 0.5) * amp2;

        if (x === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    
    ctx.stroke();
}

function animate() {
    calculateTransitions();
    drawWave();
    
    time += transitionSpeed;
    requestAnimationFrame(animate);
}

// Start the render loop
animate();
