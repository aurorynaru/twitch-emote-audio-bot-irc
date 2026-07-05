
const STARTING_POINTS = 1000000;
const BET_AMOUNT = 1000;
const ITERATIONS = 100000;

function simulate(hasPercentCap) {
    let points = STARTING_POINTS;
    let wins = 0;
    let losses = 0;
    
    // Player has a massive 200% buff from being level 2000
    const playerBuff = 2.0; 
    
    for (let i = 0; i < ITERATIONS; i++) {
        points -= BET_AMOUNT; // take bet
        
        let isWin = Math.random() < 0.4; // 40% win rate
        
        if (isWin) {
            wins++;
            let winProfit = BET_AMOUNT;
            let totalExtra = winProfit * playerBuff; // they get 2000 extra points
            
            // APPLY CAPS
            if (hasPercentCap) {
                // 50% max bonus cap
                const maxExtra = Math.floor(winProfit * 0.50);
                if (totalExtra > maxExtra) totalExtra = maxExtra;
            }
            
            points += winProfit + totalExtra + BET_AMOUNT; // give back bet + profit + extra
        } else {
            losses++;
        }
    }
    
    return { points, wins, losses };
}

const withoutFix = simulate(false);
const withFix = simulate(true);

console.log("=== SIMULATION: 100,000 GAMBLES (40% Win Rate, 1000 Bet) ===");
console.log(`\nSCENARIO 1: NO % LIMIT (Infinite Money Glitch)`);
console.log(`Wins: ${withoutFix.wins} | Losses: ${withoutFix.losses}`);
console.log(`Total Profit: ${withoutFix.points - STARTING_POINTS}`);

console.log(`\nSCENARIO 2: WITH 50% CAP (Fixed Math)`);
console.log(`Wins: ${withFix.wins} | Losses: ${withFix.losses}`);
console.log(`Total Profit: ${withFix.points - STARTING_POINTS}`);

