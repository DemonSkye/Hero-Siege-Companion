import {expect,test,vi,afterEach} from "vitest";
import {ref} from "vue";
import {marketItemByKey} from "../../src/renderer/src/lib/market-items";
import {useSavedMarketItems} from "../../src/renderer/src/lib/saved-market-items";
import {useMarketSearchRuntime} from "../../src/renderer/src/lib/market-search-runtime";
import {handleMarketSearchRequest} from "../../src/main/market-search-handler";
import {inspectDirectMarketResponse} from "../../src/main/market-direct-response";
import {marketContextFixture} from "../fixtures/market";
import accepted from "../fixtures/market-accepted-transformed.json";
import {EXPECTED_RUNEWORD_REPOSITORY_IDS} from "../fixtures/runeword-market-permutation";
import {companionState} from "../renderer/fixtures";
import type {MarketSearchRequest} from "../../src/shared/market-search";

afterEach(()=>{vi.doUnmock("node:worker_threads");vi.resetModules();});

test("all 100 native selectors compose catalog draft, explicit action, main validation, serialization and response reduction",async()=>{
  // Import the production builder without auto-starting a worker. No HTTP call
  // is made. The retained gloves response is a plumbing control, not evidence
  // that the backend matches each runeword selector.
  vi.doMock("node:worker_threads",()=>{const thread={parentPort:null,workerData:null};return {...thread,default:thread};});
  const {buildDirectMarketRequestBody}=await import("../../src/main/market-direct-search-worker");
  const readiness=ref(companionState().marketReadiness);readiness.value.canSearch=true;
  const now=ref(1000);
  const provider={search:vi.fn(async(request:MarketSearchRequest)=>{
    const form=new URLSearchParams(buildDirectMarketRequestBody(marketContextFixture,request));
    expect(form.get("filter_masks")).toBe("[]");
    expect(form.get("filter_runeword")).toBe(String(EXPECTED_RUNEWORD_REPOSITORY_IDS[provider.search.mock.calls.length-1]));
    expect(form.get("scroll_page")).toBe("0");
    expect(form.get("filter_sockets_min")).toBe("4");
    expect(form.get("stat_filter")).toBe("W3sic3RhdElkIjoyNzEsImZpbHRlciI6Miwic3RhdFZhbHVlIjoxMH1d");
    return {...inspectDirectMarketResponse(Buffer.from(accepted.response.bodyBase64,"base64"),200).response,nextAllowedSearchAt:now.value+15000};
  })};
  const searchMarket=vi.fn((request:MarketSearchRequest)=>handleMarketSearchRequest(request,provider));
  const runtime=useMarketSearchRuntime({searchMarket,now,readiness});
  const saved=useSavedMarketItems(ref([]),runtime);
  for(let index=0;index<100;index++){
    const item=marketItemByKey(`runeword:3:0:${index}`)!;
    saved.selectItem(item);runtime.updateMinSockets(4);runtime.addStatFilter(271);
    runtime.updateStatFilter(runtime.statFilters.value[0].key,{minimum:10});
    expect(runtime.draftRequest.value).toEqual({runewordId:EXPECTED_RUNEWORD_REPOSITORY_IDS[index],minSockets:4,statFilters:[{statId:271,minimum:10}]});
    expect(searchMarket).toHaveBeenCalledTimes(index);
    await runtime.searchMarket();
    expect(runtime.phase.value).toBe("success");
    expect(runtime.listings.value.map(item=>item.price)).toEqual([4000,6000,7000,10000,11000,12000,13000,14000,
      15000,15000,20000,20000,20000,20000,28888,30000,30000,33333,33333,33333]);
    expect(runtime.returnedCount.value).toBe(101);
    now.value+=15001;
  }
  expect(provider.search).toHaveBeenCalledTimes(100);
  expect(searchMarket).toHaveBeenCalledTimes(100);
  await expect(handleMarketSearchRequest({runewordId:81,itemMask:1073746020,statFilters:[]},provider)).resolves.toEqual({ok:false,errorCode:"request_rejected"});
  expect(provider.search).toHaveBeenCalledTimes(100);
});

test.each([
  {itemMask:1073746020,statFilters:[{statId:185,minimum:103}]},
  {runewordId:81,statFilters:[{statId:347,minimum:1}]},
  {itemMask:65559,statFilters:[{statId:35,minimum:1}]},
  {itemMask:1073746020,statFilters:[{statId:20,minimum:4}]},
])("main boundary rejects metadata, collection, selected table and misplaced sockets before provider dispatch: %j",async request=>{
  const provider={search:vi.fn()};
  await expect(handleMarketSearchRequest(request,provider)).resolves.toEqual({ok:false,errorCode:"request_rejected"});
  expect(provider.search).not.toHaveBeenCalled();
});
