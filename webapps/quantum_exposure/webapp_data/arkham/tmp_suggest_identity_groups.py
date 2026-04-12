import csv
import json
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent
IDENTITY_GROUPS_PATH = ROOT / "identity_groups.json"
OUTPUT_PATH = ROOT / "tmp_identity_group_suggestions.csv"

GROUP_EXCHANGES = "Exchanges, brokerages, and custody services"
GROUP_GOV = "Governments, public sector, and charities"
GROUP_INSTITUTIONS = "Institutions, funds, and corporates"
GROUP_MINING = "Mining pools and mining companies"
GROUP_PAYMENTS = "Payments, wallets, and merchant services"
GROUP_PROTOCOLS = "Protocols, bridges, defi, and wrapped assets"
GROUP_CASINOS = "Casinos, betting, and gaming"
GROUP_DARKNET = "Darknet mixers and illicit services"
GROUP_SCAMS = "Hacks, scams, and ransomware"
GROUP_INDIVIDUALS = "Individuals"


EXPLICIT_GROUPS = {
    "001K Bot": (GROUP_INSTITUTIONS, "low", "Bot/service label; likely an operating entity rather than an exchange or protocol."),
    "1THash": (GROUP_MINING, "high", "Mining pool/mining operator label by name."),
    "4222": ("unidentified", "low", "Opaque numeric entity label; defaulting to general institutional/corporate bucket pending manual review."),
    "Aave": (GROUP_PROTOCOLS, "high", "Protocol/DeFi label."),
    "Agentd": (GROUP_MINING, "low", "Opaque service/entity label; defaulting to general institutional/corporate bucket."),
    "ALFAcoins": (GROUP_PAYMENTS, "high", "Crypto payments processor / merchant gateway."),
    "Arkham": (GROUP_EXCHANGES, "medium", "Corporate intelligence/analytics company rather than a custody venue or protocol."),
    "Avalanche": (GROUP_PROTOCOLS, "high", "Blockchain protocol / ecosystem label."),
    "Bittrex": (GROUP_EXCHANGES, "high", "Centralized exchange / trading venue."),
    "BingX": (GROUP_EXCHANGES, "high", "Centralized exchange / trading venue."),
    "Bit2C": (GROUP_EXCHANGES, "high", "Exchange / brokerage brand."),
    "Bitaces.me": (GROUP_CASINOS, "medium", "Brand reads more like a betting/gaming service than an institutional venue."),
    "BitConnect": (GROUP_SCAMS, "high", "Known scam / Ponzi label."),
    "Bitcoin Depot": (GROUP_PAYMENTS, "medium", "Bitcoin ATM / retail payments access network."),
    "BitcoinTalk": (GROUP_INSTITUTIONS, "medium", "Community/forum brand; best fit is general institutional/corporate bucket."),
    "Blockchain.com": (GROUP_PAYMENTS, "high", "Wallet and consumer-facing payments platform label."),
    "Bitmain": (GROUP_MINING, "high", "Mining hardware / mining company."),
    "Bitfarms": (GROUP_MINING, "high", "Public mining company."),
    "Bit Digital": (GROUP_MINING, "high", "Public mining company."),
    "Bitnuvem": (GROUP_EXCHANGES, "high", "Exchange / brokerage brand."),
    "Bitzillions": (GROUP_CASINOS, "medium", "Name suggests gambling / gaming activity rather than exchange services."),
    "Boring DAO": (GROUP_PROTOCOLS, "high", "DAO / bridge / wrapped-asset protocol."),
    "Bridgers": (GROUP_PROTOCOLS, "medium", "Bridge / interoperability routing brand by name."),
    "Celo": (GROUP_PROTOCOLS, "high", "Blockchain protocol / ecosystem label."),
    "CleanSpark": (GROUP_MINING, "high", "Public mining company."),
    "CoinGate": (GROUP_PAYMENTS, "high", "Merchant payments processor."),
    "CoinCorner": (GROUP_EXCHANGES, "high", "Exchange / brokerage brand."),
    "Coinhako": (GROUP_EXCHANGES, "high", "Exchange / brokerage brand."),
    "CoinList": (GROUP_EXCHANGES, "medium", "Token-sale / exchange-style platform and brokerage venue."),
    "Coinroll": (GROUP_CASINOS, "high", "Gambling / dice-style gaming brand."),
    "Coinkite": (GROUP_PAYMENTS, "high", "Hardware wallet company and wallet infrastructure brand."),
    "Core Scientific": (GROUP_MINING, "high", "Public mining / hosting company."),
    "CrimeNetwork.biz": (GROUP_DARKNET, "high", "Clearly illicit marketplace/service label."),
    "Cross": (GROUP_EXCHANGES, "low", "Generic crypto-infrastructure style label; best provisional fit is protocol/bridge bucket."),
    "CSGO Empire": (GROUP_CASINOS, "high", "Gaming / betting platform."),
    "DBS Bank": (GROUP_EXCHANGES, "medium", "Bank-led custody / brokerage style Bitcoin exposure; best fit is exchange/custody bucket."),
    "DeepBit": (GROUP_MINING, "high", "Historic mining pool."),
    "DeFi Technologies": (GROUP_PROTOCOLS, "high", "Blockchain infrastructure / protocol ecosystem label."),
    "Dustin Trammell @druidian": (GROUP_INDIVIDUALS, "high", "Person-labeled identity."),
    "El Salvador Government": (GROUP_GOV, "high", "Government-held/public-sector Bitcoin label."),
    "Enigma Securities": (GROUP_INSTITUTIONS, "high", "Institutional trading / securities firm."),
    "Ethereum Foundation": (GROUP_PROTOCOLS, "medium", "Protocol ecosystem foundation rather than a custodial institution."),
    "FalconX": (GROUP_INSTITUTIONS, "high", "Institutional brokerage / prime services firm."),
    "Fasanara Capital": (GROUP_INSTITUTIONS, "high", "Asset manager / institutional capital firm."),
    "FTX": (GROUP_EXCHANGES, "high", "Centralized exchange label."),
    "FTX US": (GROUP_EXCHANGES, "high", "Centralized exchange label."),
    "Flow Traders": (GROUP_INSTITUTIONS, "high", "Institutional trading firm / market maker."),
    "Fortress Trust": (GROUP_EXCHANGES, "medium", "Custody / trust-services provider; best fit is exchange/custody bucket."),
    "Fran Finney": (GROUP_INDIVIDUALS, "high", "Person-labeled identity."),
    "FreeBitco.in": (GROUP_CASINOS, "high", "Gaming / faucet / betting-style service."),
    "Freewallet": (GROUP_PAYMENTS, "high", "Wallet-provider label."),
    "Galaxy Digital": (GROUP_INSTITUTIONS, "high", "Institutional trading / asset-management firm."),
    "German Government": (GROUP_GOV, "high", "Government/public-sector holdings label."),
    "GermanPlazaMarket": (GROUP_DARKNET, "high", "Dark-market / illicit marketplace label."),
    "Genesis Trading": (GROUP_INSTITUTIONS, "high", "Institutional trading / brokerage firm."),
    "GSR Markets": (GROUP_INSTITUTIONS, "high", "Institutional market maker / trading firm."),
    "Halcyon Super Holdings": (GROUP_CASINOS, "medium", "Holding-company style label; best fit is institutional/corporate bucket."),
    "Hashnest": (GROUP_MINING, "high", "Cloud mining / mining-infrastructure brand."),
    "Hydra Market": (GROUP_DARKNET, "high", "Darknet market label."),
    "IREN": (GROUP_MINING, "high", "Public mining company (Iris Energy/IREN)."),
    "Jane Street": (GROUP_INSTITUTIONS, "high", "Institutional trading firm / market maker."),
    "Kraken Darknet": (GROUP_DARKNET, "high", "Darknet / illicit-market label, not the exchange."),
    "Knc Miner": (GROUP_MINING, "high", "Mining hardware / mining operator label."),
    "Kyber Network": (GROUP_PROTOCOLS, "high", "Protocol / network label."),
    "Lazarus Group": (GROUP_SCAMS, "high", "Known hacking / cybercrime actor."),
    "Liquid": (GROUP_PROTOCOLS, "high", "Bitcoin-sidechain / protocol label."),
    "Lorenzo Protocol": (GROUP_PROTOCOLS, "high", "Protocol label by name."),
    "LuckyB.it": (GROUP_CASINOS, "high", "Betting / gaming brand."),
    "M2": (GROUP_EXCHANGES, "medium", "Exchange/custody brand in crypto context; best fit is exchange bucket."),
    "Maya Protocol": (GROUP_PROTOCOLS, "high", "Protocol label by name."),
    "Mercado Libre": (GROUP_INSTITUTIONS, "medium", "Large corporate/platform brand rather than exchange or wallet provider."),
    "MiningRigRentals.com": (GROUP_MINING, "high", "Mining infrastructure / hashpower marketplace."),
    "Nakamoto": (GROUP_INSTITUTIONS, "medium", "Bitcoin treasury company label; best fit is institutional/corporate bucket."),
    "Nastyfans.org": (GROUP_MINING, "medium", "Mining/community mining-share brand."),
    "NetWalker Ransomeware": (GROUP_SCAMS, "high", "Ransomware label."),
    "NoOnes.com": (GROUP_EXCHANGES, "medium", "Peer-to-peer trading / exchange-style platform."),
    "Norwegian Block": (GROUP_EXCHANGES, "medium", "Corporate/holding-style label; best fit is institutions/corporates."),
    "OneCoin Ponzi": (GROUP_SCAMS, "high", "Ponzi / scam label."),
    "OpenNode": (GROUP_PAYMENTS, "high", "Bitcoin payments processor / merchant services."),
    "OXBTC": (GROUP_MINING, "high", "Mining pool / hashpower service label."),
    "Osprey Funds": (GROUP_INSTITUTIONS, "high", "Fund / asset-manager label."),
    "Phoenix Group": (GROUP_MINING, "high", "Mining company label."),
    "Phoenix Group UAE": (GROUP_MINING, "high", "Mining company label."),
    "PlusToken Ponzi": (GROUP_SCAMS, "high", "Ponzi / scam label."),
    "Poolin": (GROUP_MINING, "high", "Mining pool."),
    "Prime Trust": (GROUP_EXCHANGES, "high", "Custody / trust-services provider."),
    "Relay.link": (GROUP_PROTOCOLS, "high", "Bridge / routing protocol label."),
    "Rollbit": (GROUP_CASINOS, "high", "Casino / betting brand."),
    "Russian Anonymous Marketplace": (GROUP_DARKNET, "high", "Clearly illicit marketplace label."),
    "SaveLife": (GROUP_GOV, "low", "Public fundraising / aid organization; closest fit is public-sector/donations bucket."),
    "Sequans": (GROUP_INSTITUTIONS, "medium", "Corporate treasury / listed-company style label."),
    "Shitcoins.Club": (GROUP_PAYMENTS, "high", "Bitcoin ATM / retail cash-access network."),
    "Stake.com": (GROUP_CASINOS, "high", "Online betting / casino brand."),
    "Stacks": (GROUP_PROTOCOLS, "high", "Blockchain protocol / ecosystem label."),
    "Suex.io": (GROUP_DARKNET, "high", "Sanctioned illicit OTC/exchange-style service."),
    "Terraform Labs": (GROUP_PROTOCOLS, "high", "Protocol ecosystem / issuer label."),
    "The Pirate Bay": (GROUP_DARKNET, "medium", "Illicit-service / piracy platform label."),
    "Threshold Network": (GROUP_PROTOCOLS, "high", "Protocol/network label."),
    "Teleport DAO": (GROUP_PROTOCOLS, "high", "DAO / protocol label."),
    "Three Arrows Capital": (GROUP_INSTITUTIONS, "high", "Fund / institutional investment firm."),
    "UAE Royal Group": (GROUP_GOV, "low", "Royal-family/public-sector-adjacent label; closest fit is public-sector bucket."),
    "VBTC": (GROUP_PROTOCOLS, "high", "Wrapped-BTC style protocol / asset label."),
    "Voyager": (GROUP_EXCHANGES, "high", "Brokerage / custodial platform."),
    "WBTCB": (GROUP_PROTOCOLS, "high", "Wrapped-BTC style asset label."),
    "Wintermute": (GROUP_INSTITUTIONS, "high", "Institutional market maker / trading firm."),
    "WOO Network": (GROUP_EXCHANGES, "medium", "Network/protocol brand, not primarily a custodial institution."),
    "WisdomTree": (GROUP_INSTITUTIONS, "high", "Asset manager / ETF sponsor."),
    "Wagon Bet": (GROUP_CASINOS, "high", "Betting / gaming label."),
    "Zaif": (GROUP_EXCHANGES, "high", "Exchange / brokerage brand."),
    "Zhimin Qian & Jian Wen Fraud": (GROUP_SCAMS, "high", "Fraud / criminal-proceeds label."),
}

EXCHANGE_KEYWORDS = (
    "exchange", "trade", "trading", "markets", "market", "broker", "prime", "dex", "swap"
)
PAYMENTS_KEYWORDS = ("pay", "wallet", "cash", "depot", "merchant")
MINING_KEYWORDS = ("pool", "miner", "mining", "hash", "rig")
PROTOCOL_KEYWORDS = ("protocol", "network", "dao", "bridge", "wrapped", "chain")
CASINO_KEYWORDS = ("bet", "dice", "casino", "game", "gaming", "poker")
DARKNET_KEYWORDS = ("darknet", "marketplace", "market", "onion", "pirate")
SCAM_KEYWORDS = ("ransomware", "fraud", "ponzi", "hacker", "scam")


def load_ungrouped() -> list[dict]:
    data = json.loads(IDENTITY_GROUPS_PATH.read_text(encoding="utf-8"))
    grouped = set()
    for items in data["groups"].values():
        grouped.update(items)

    ungrouped: dict[str, dict] = {}
    for csv_path in ROOT.rglob("dashboard_pubkeys_ge_1btc.csv"):
        try:
            height = int(csv_path.parent.name)
        except ValueError:
            continue

        with csv_path.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                identity = (row.get("identity") or "").strip()
                if not identity or identity.lower() == "unidentified" or identity in grouped:
                    continue

                info = ungrouped.setdefault(
                    identity,
                    {
                        "count": 0,
                        "heights": set(),
                        "first_height": height,
                        "last_height": height,
                    },
                )
                info["count"] += 1
                info["heights"].add(height)
                info["first_height"] = min(info["first_height"], height)
                info["last_height"] = max(info["last_height"], height)

    rows = []
    for identity, info in sorted(ungrouped.items(), key=lambda item: (-item[1]["count"], item[0].lower())):
        rows.append(
            {
                "identity": identity,
                "count": info["count"],
                "first_height": info["first_height"],
                "last_height": info["last_height"],
                "height_count": len(info["heights"]),
            }
        )
    return rows


def fallback_suggestion(identity: str) -> tuple[str, str, str]:
    lowered = identity.lower()

    if any(keyword in lowered for keyword in SCAM_KEYWORDS):
        return GROUP_SCAMS, "medium", "Label explicitly references fraud/scam/ransomware activity."
    if any(keyword in lowered for keyword in CASINO_KEYWORDS):
        return GROUP_CASINOS, "medium", "Brand name suggests betting, dice, casino, or gaming activity."
    if "government" in lowered or "royal" in lowered:
        return GROUP_GOV, "medium", "Label indicates a government or public-sector/royal entity."
    if any(keyword in lowered for keyword in MINING_KEYWORDS):
        return GROUP_MINING, "medium", "Label indicates mining, hashpower, or pool activity."
    if any(keyword in lowered for keyword in PROTOCOL_KEYWORDS):
        return GROUP_PROTOCOLS, "medium", "Label indicates a protocol, network, DAO, bridge, or wrapped-asset system."
    if any(keyword in lowered for keyword in PAYMENTS_KEYWORDS):
        return GROUP_PAYMENTS, "medium", "Label suggests wallet, payments, cash, ATM, or merchant rails."
    if any(keyword in lowered for keyword in EXCHANGE_KEYWORDS):
        return GROUP_EXCHANGES, "medium", "Label suggests an exchange, trading venue, brokerage, or custody provider."
    if identity.replace(".", "").replace(" ", "").isdigit():
        return GROUP_INSTITUTIONS, "low", "Opaque placeholder-style label; defaulting to institutions/corporates pending review."
    return GROUP_EXCHANGES, "low", "Defaulting to exchange/custody bucket because most remaining labels are service venues; review recommended."


def main() -> None:
    rows = load_ungrouped()
    with OUTPUT_PATH.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "identity",
                "count",
                "first_height",
                "last_height",
                "height_count",
                "suggested_group",
                "confidence",
                "reason",
            ],
        )
        writer.writeheader()
        for row in rows:
            identity = row["identity"]
            suggested_group, confidence, reason = EXPLICIT_GROUPS.get(identity, fallback_suggestion(identity))
            writer.writerow(
                {
                    **row,
                    "suggested_group": suggested_group,
                    "confidence": confidence,
                    "reason": reason,
                }
            )

    print(f"wrote {OUTPUT_PATH}")
    print(f"rows {len(rows)}")


if __name__ == "__main__":
    main()