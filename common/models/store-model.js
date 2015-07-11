var Promise = require('bluebird');

var path = require('path');
var fileName = path.basename(__filename, '.js'); // gives the filename without the .js extension
var log = require('debug')('common:models:'+fileName);

// HINT(s):
//   Getting the app object: http://docs.strongloop.com/display/public/LB/Working+with+LoopBack+objects
//   From a model script: http://docs.strongloop.com/display/public/LB/Working+with+LoopBack+objects#WorkingwithLoopBackobjects-Fromamodelscript
module.exports = function(StoreModel) {

  // https://github.com/strongloop/loopback/issues/418
  // once a model is attached to the data source
  StoreModel.on('dataSourceAttached', function(obj){
    // wrap the whole model in Promise
    // but we need to avoid 'validate' method
    StoreModel = Promise.promisifyAll(
      StoreModel,
      {
        filter: function(name, func, target){
          return !( name == 'validate');
        }
      }
    );
  });

  StoreModel.importProducts = function(id, cb) {
    var currentUser = StoreModel.getCurrentUserModel(cb); // returns immediately if no currentUser
    if (currentUser) {
      console.log('inside StoreModel.importProducts() - currentUser: ', currentUser.username);

      // TODO: the following THEN blocks can be lined up and don't have to be nested

      // (1)
      StoreModel.findById(id)
        .then(function(storeModel){
          console.log('print object for storeModel: ', storeModel);

          // (2)
          StoreModel.app.models.StoreConfigModel.findOne( //TODO: use findByIdAsync instead?
            {filter:{where: {id: id}}} // TODO: how can the same ID be used for both store and store-config???
          )
            .then(function(storeConfigModel){
              console.log('print object for storeConfigModel: ', storeConfigModel);

              // (3)
              StoreModel.app.models.GlobalConfigModel.findOne({})
                .then(function(globalConfigModel){
                  console.log('print object for globalConfigModel: ', globalConfigModel);

                  // (4)
                  startProductImportJob(storeModel, storeConfigModel, globalConfigModel)
                    .then(function(result){
                      console.log('inside StoreModel.importProducts() - finished', result);
                      cb(null, result);
                    }, function(error){
                      cb(error);
                    });

                })
                .catch(function(error){
                  cb(error);
                });

              cb(null);
            })
            .catch(function(error){
              cb(error);
            });
        })
        .catch(function(error){
          cb(error);
        });
    }
  };

  StoreModel.remoteMethod(
    'importProducts',
    {
      accepts: [
        {arg: 'string', type: 'number', required: true}
      ],
      //http: {path:'/import-products', verb: 'get'}
      http: {path: '/:id/import-products', verb: 'get'}
    }
  );

  var q = require('q')
    , responseHandler = require('../utils/response-handler')
    , request = require('request');

  var startProductImportJob = function(storeModel, storeConfigModel, globalConfigModel) {
    console.log('inside startProductImportJob() - store id: ' + storeModel.objectId);
    console.log(JSON.stringify({
      'store': storeModel,
      'storeConfig': storeConfigModel,
      'globalConfig': globalConfigModel
    },null,2));

    var deferred = q.defer();
    request.post({
      url: StoreModel.app.get('ironWorkersUrl'),
      qs: {
        'code_name': StoreModel.app.get('productImportWorker'),
        'oauth': StoreModel.app.get('ironWorkersOauthToken'),
        'priority': 1
      },
      json: {
        'store': storeModel,
        'storeConfig': storeConfigModel,
        'globalConfig': globalConfigModel
      }
    }, function(err, resp, body){
      responseHandler.processResponse(err, resp, body)
        .then(function(result){
          deferred.resolve(result);
        },
        function(error){
          deferred.reject(error);
        });
    });

    return deferred.promise;
  };

  StoreModel.setDesiredStockLevelForVend = function(id, productId, desiredStockLevel, cb) {
    log('inside setDesiredStockLevelForVend()');
    var currentUser = StoreModel.getCurrentUserModel(cb); // returns immediately if no currentUser

    if(currentUser) {
      var oauthVendUtil = require('./../../common/utils/vend')({
        'GlobalConfigModel': StoreModel.app.models.GlobalConfigModel,
        'StoreConfigModel': StoreModel.app.models.StoreConfigModel,
        'currentUser': currentUser
      });
      StoreModel.findOne(
        {where: {objectId: id}}
      )
        .then(function(storeModelInstance){
          var storeConfigId = storeModelInstance.storeConfigModelToStoreModelId;
          var outletId = storeModelInstance.api_id;
          oauthVendUtil.setDesiredStockLevelForVend(storeConfigId, outletId, productId, desiredStockLevel)
            .then(function(/*product*/){
              cb(null); //cb(null, product); // Question: we don't want to expose the entire product to client side?
            },
            function(error){
              cb(error);
            });
        });
    }
  };

  StoreModel.remoteMethod('setDesiredStockLevelForVend', {
    accepts: [
      {arg: 'id', type: 'string', required: true},
      {arg: 'productId', type: 'string', required: true},
      {arg: 'desiredStockLevel', type: 'number', required: true}
    ],
    http: {path: '/:id/vend/product', verb: 'put'}
  });
};
